import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const customPlaylistId = searchParams.get('customPlaylistId');

  if (!category && !customPlaylistId) {
    return NextResponse.json({ error: 'Category or Custom Playlist ID required' }, { status: 400 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'YouTube API Key is missing in .env.local' }, { status: 500 });
  }

  try {
    let playlistId = customPlaylistId;

    // 1. If no custom ID was provided, find a valid user-created playlist for the requested category
    if (!playlistId) {
      const searchRes = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=playlist&maxResults=1&q=${encodeURIComponent(category + ' music hits')}&key=${apiKey}`
      );
      const searchData = await searchRes.json();
      
      if (!searchData.items || searchData.items.length === 0) {
         return NextResponse.json({ error: 'No playlists found for this category' }, { status: 404 });
      }
      
      playlistId = searchData.items[0].id.playlistId;
    }

    // 2. Fetch the videos from the found or provided playlist

    const ytResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${apiKey}`
    );
    
    const data = await ytResponse.json();

    if (!data.items) {
      return NextResponse.json({ error: 'Invalid playlist or API quota exceeded', details: data }, { status: 400 });
    }

    // Transform YouTube API response into our game's Song format
    const songs = data.items.map((item: any) => {
      // YouTube titles usually are "Artist - Song Name (Official Video)" etc.
      // We'll just pass the full title as trackName for now
      return {
        trackName: item.snippet.title,
        artistName: item.snippet.videoOwnerChannelTitle || 'YouTube',
        youtubeId: item.snippet.resourceId.videoId,
        // Start anywhere between 15s and 60s
        startAt: Math.floor(Math.random() * 45) + 15, 
        artworkUrl100: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url
      };
    });

    // Remove private/deleted videos
    const validSongs = songs.filter((s: any) => s.artistName !== 'YouTube' && !s.trackName.includes('Private video') && !s.trackName.includes('Deleted video'));

    return NextResponse.json(validSongs);
  } catch (error) {
    console.error('YouTube API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch playlist' }, { status: 500 });
  }
}
