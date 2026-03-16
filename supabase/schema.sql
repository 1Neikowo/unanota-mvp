-- Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pin_code text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'playing', 'buzzed', 'voting', 'results')),
  current_song_url text,
  current_song_name text,
  current_song_artwork text,
  buzzed_player_id uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create players table
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  score integer DEFAULT 0,
  has_voted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create votes table
CREATE TABLE IF NOT EXISTS votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  voter_id uuid REFERENCES players(id) ON DELETE CASCADE,
  is_correct boolean NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Turn on Realtime for rooms and players (votes aren't strictly needed for realtime MVP if we calculate them later)
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table votes;

-- Enable Row Level Security (RLS) but allow ALL for MVP simplicity
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read rooms" ON rooms FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert rooms" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update rooms" ON rooms FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete rooms" ON rooms FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read players" ON players FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert players" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update players" ON players FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete players" ON players FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read votes" ON votes FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert votes" ON votes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update votes" ON votes FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete votes" ON votes FOR DELETE USING (true);
