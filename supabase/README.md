# Stake Multi Builder — Supabase Integration

Adds user accounts and cloud sync so bet history syncs across devices.

## Architecture

```
Browser App
  → Supabase Auth (magic link / Google OAuth)
  → Supabase DB (bet_history table per user)
  → Realtime sync across devices
```

## Setup

1. **Create project** at supabase.com (free tier: 500MB DB, 50k MAU)
2. Get your project URL and anon key from Settings > API
3. Add to index.html:
   ```js
   const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
   const SUPABASE_ANON_KEY = 'your-anon-key';
   ```

## Database Schema

Run this SQL in the Supabase SQL editor:

```sql
-- Enable RLS
create table public.bet_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date timestamptz not null,
  legs jsonb not null,
  combined_odds numeric not null,
  result text check (result in ('pending', 'won', 'lost', 'void')) default 'pending',
  stake numeric default 10,
  auto_checked boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Row Level Security: users can only see their own bets
alter table public.bet_history enable row level security;

create policy "Users can view own bets"
  on public.bet_history for select
  using (auth.uid() = user_id);

create policy "Users can insert own bets"
  on public.bet_history for insert
  with check (auth.uid() = user_id);

create policy "Users can update own bets"
  on public.bet_history for update
  using (auth.uid() = user_id);

create policy "Users can delete own bets"
  on public.bet_history for delete
  using (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger bet_history_updated_at
  before update on public.bet_history
  for each row execute function update_updated_at();
```

## Client Integration (add to index.html)

```js
// Load Supabase client (add to <head>)
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>

const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Auth: magic link login
async function loginWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) showStatus('Login failed: ' + error.message, 'error');
  else showStatus('Check your email for a login link!', 'success');
}

// Auth: Google OAuth
async function loginWithGoogle() {
  await supabase.auth.signInWithOAuth({ provider: 'google' });
}

// Sync: push local history to Supabase
async function syncToCloud() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  for (const entry of betHistory) {
    if (entry.synced) continue;
    const { error } = await supabase.from('bet_history').upsert({
      user_id: user.id,
      date: entry.date,
      legs: entry.legs,
      combined_odds: entry.combinedOdds,
      result: entry.result || 'pending',
      stake: entry.stake || 10,
      auto_checked: entry.autoChecked || false,
    });
    if (!error) entry.synced = true;
  }
  saveHistory();
}

// Sync: pull from Supabase to local
async function syncFromCloud() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data, error } = await supabase
    .from('bet_history')
    .select('*')
    .order('date', { ascending: false });

  if (error || !data) return;

  // Merge cloud with local (cloud wins on conflicts)
  const cloudDates = new Set(data.map(d => d.date));
  const localOnly = betHistory.filter(b => !cloudDates.has(b.date));

  betHistory = [
    ...data.map(d => ({
      date: d.date,
      legs: d.legs,
      combinedOdds: d.combined_odds,
      result: d.result,
      stake: d.stake,
      autoChecked: d.auto_checked,
      synced: true,
    })),
    ...localOnly,
  ].sort((a,b) => new Date(b.date) - new Date(a.date));

  saveHistory();
  renderHistory();
}

// Listen for auth state changes
supabase?.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN') {
    syncFromCloud();
    showStatus('Signed in — syncing history...', 'success');
  }
});
```

## Pro Tier Gating

To gate features behind a Pro subscription, add a `profiles` table:

```sql
create table public.profiles (
  id uuid references auth.users(id) primary key,
  plan text default 'free' check (plan in ('free', 'pro')),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

Then check `plan === 'pro'` before allowing proxy access (worker checks JWT).

## Cost

- **Free tier**: 500MB DB, 50k MAU, 2GB bandwidth — enough for ~1000 users
- **Pro tier**: $25/month for unlimited (after product-market fit)
