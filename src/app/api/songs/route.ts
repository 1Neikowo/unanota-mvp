import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const term = searchParams.get('term') || 'party hits';

  try {
    const response = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(
        term
      )}&entity=song&limit=50`
    );
    const data = await response.json();

    // Filter only songs with a preview URL
    const validSongs = data.results.filter((song: any) => song.previewUrl);

    return NextResponse.json(validSongs);
  } catch (error) {
    console.error('Error fetching songs from iTunes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch songs' },
      { status: 500 }
    );
  }
}
