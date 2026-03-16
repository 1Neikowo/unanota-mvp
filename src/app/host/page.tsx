'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Play, Loader2, Music, Check, X, Users, Trophy } from 'lucide-react'
import YouTube from 'react-youtube'

// The Categories the Host can choose from
const CATEGORIES = [
  { name: 'Pop Hits 2024' },
  { name: 'Top 50 Chile' },
  { name: 'Rock de los 80' },
  { name: 'Reggaeton Antiguo' },
  { name: 'Anime Openings' },
  { name: 'Disney Clásicos' },
  // EJEMPLO de cómo agregar una con ID de Playlist directa:
  { name: 'Easykid', playlistId: 'PLxA687tYuMWh_K7R-29OGzhIma_x2RpzZ' }
]

type RoomStatus = 'lobby' | 'playing' | 'buzzed' | 'voting' | 'results';

interface Player {
  id: string;
  name: string;
  score: number;
  has_voted: boolean;
}

export default function HostPage() {
  const [roomId, setRoomId] = useState<string | null>(null)
  const [pinCode, setPinCode] = useState<string>('')
  const [status, setStatus] = useState<RoomStatus>('lobby')
  const [players, setPlayers] = useState<Player[]>([])

  const [currentSong, setCurrentSong] = useState<any>(null)
  const [buzzedPlayer, setBuzzedPlayer] = useState<Player | null>(null)
  const [votes, setVotes] = useState<{ correct: number, wrong: number }>({ correct: 0, wrong: 0 })
  const [category, setCategory] = useState<string>('Pop Hits 2024')
  const [customUrl, setCustomUrl] = useState<string>('')

  const playerRef = useRef<any>(null)

  // Initialization: Create Room
  useEffect(() => {
    async function createRoom() {
      const pin = Math.floor(1000 + Math.random() * 9000).toString()
      const { data, error } = await supabase
        .from('rooms')
        .insert([{ pin_code: pin, status: 'lobby' }])
        .select()
        .single()

      if (data) {
        setRoomId(data.id)
        setPinCode(data.pin_code)
      } else {
        console.error('Error creating room:', error)
      }
    }
    createRoom()

    // Cleanup on exit
    return () => {
      if (roomId) {
        supabase.from('rooms').delete().eq('id', roomId).then()
      }
    }
  }, []) // Empty dependency array, run once on mount

  // Realtime Subscriptions
  useEffect(() => {
    if (!roomId) return

    // Subscribe to players joining/updating
    const playersChannel = supabase
      .channel('public:players')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
        (payload) => {
          fetchPlayers()
        })
      .subscribe()

    // Subscribe to room updates (for buzzer and state changes)
    const roomChannel = supabase
      .channel('public:rooms')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          const updatedRoom = payload.new as any;
          if (updatedRoom.status === 'buzzed' && updatedRoom.buzzed_player_id) {
            handleBuzzerPressed(updatedRoom.buzzed_player_id)
          }
        })
      .subscribe()

    // Subscribe to votes
    const votesChannel = supabase
      .channel('public:votes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes', filter: `room_id=eq.${roomId}` },
        (payload) => {
          setVotes(prev => ({
            correct: prev.correct + (payload.new.is_correct ? 1 : 0),
            wrong: prev.wrong + (!payload.new.is_correct ? 1 : 0)
          }))

          // Check if everyone voted
          checkAllVotes()
        })
      .subscribe()

    return () => {
      supabase.removeChannel(playersChannel)
      supabase.removeChannel(roomChannel)
      supabase.removeChannel(votesChannel)
    }
  }, [roomId])

  const fetchPlayers = async () => {
    if (!roomId) return
    const { data } = await supabase.from('players').select('*').eq('room_id', roomId).order('score', { ascending: false })
    if (data) setPlayers(data)
  }

  const startGame = async () => {
    try {
      setStatus('playing')

      let fetchUrl = `/api/youtube?category=${encodeURIComponent(category)}`

      // If the selected category from the buttons has a hardcoded playlistId, use it
      const categoryConfig = CATEGORIES.find(c => c.name === category);
      if (categoryConfig && categoryConfig.playlistId) {
        fetchUrl = `/api/youtube?customPlaylistId=${categoryConfig.playlistId}`;
      }

      // If user pasted a custom link, extract the list ID and tell the API to use it directly
      if (customUrl.trim() !== '') {
        const listMatch = customUrl.match(/[?&]list=([^#\&\?]+)/)
        const videoMatch = customUrl.match(/[?&]v=([^#\&\?]+)/)

        let playlistId = listMatch ? listMatch[1] : null;
        let videoId = videoMatch ? videoMatch[1] : null;

        if (playlistId) {
          fetchUrl = `/api/youtube?customPlaylistId=${playlistId}`
        } else if (videoId) {
          // Fallback: Just play the single video they pasted if it's not a playlist
          // We mock the API response format
          setCurrentSong({
            trackName: 'Canción a pedido',
            artistName: 'YouTube',
            youtubeId: videoId,
            startAt: 0,
            artworkUrl100: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          })

          await supabase.from('rooms').update({
            status: 'playing',
            current_song_url: `https://youtube.com/watch?v=${videoId}`,
            current_song_name: 'Canción a pedido',
            current_song_artwork: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            buzzed_player_id: null
          }).eq('id', roomId)

          return; // Stop here, we bypassed the API
        }
      }

      const res = await fetch(fetchUrl)
      if (!res.ok) throw new Error('Failed fetching playlist directly')

      const songs = await res.json()
      const randomSong = songs[Math.floor(Math.random() * songs.length)]
      setCurrentSong(randomSong)

      // 2. Update room status, using Youtube Thumbnail for artwork
      await supabase.from('rooms').update({
        status: 'playing',
        current_song_url: `https://youtube.com/watch?v=${randomSong.youtubeId}`,
        current_song_name: randomSong.trackName,
        current_song_artwork: randomSong.artworkUrl100,
        buzzed_player_id: null
      }).eq('id', roomId)

      // We no longer imperatively load the video here. The <YouTube videoId={...} /> prop will handle it.

    } catch (e) {
      console.error("Error starting game", e)
      setStatus('lobby')
    }
  }

  const handleBuzzerPressed = async (playerId: string) => {
    // If we're already buzzed locally, ignore latecomers
    if (status === 'buzzed') return;

    setStatus('buzzed')

    if (playerRef.current) {
      try {
        playerRef.current.pauseVideo()
      } catch (e) { console.error("Could not pause youtube", e) }
    }

    // Find player who buzzed
    const { data: player } = await supabase.from('players').select('*').eq('id', playerId).single()
    if (player) {
      setBuzzedPlayer(player)

      // Auto move to voting after 5 seconds of dramatic reveal
      setTimeout(async () => {
        setVotes({ correct: 0, wrong: 0 })

        // Reset player vote status
        await supabase.from('players').update({ has_voted: false }).eq('room_id', roomId)

        await supabase.from('rooms').update({ status: 'voting' }).eq('id', roomId)
        setStatus('voting')
      }, 5000)
    }
  }

  const checkAllVotes = async () => {
    // This is simple logic - ideally check if votes count == players length - 1 (the one who buzzed doesn't vote)
    // For MVP, we'll let results trigger manually or after timeout
  }

  const showResults = async () => {
    if (!buzzedPlayer || !roomId) return

    setStatus('results')

    // Calculate outcome
    const isCorrect = votes.correct >= votes.wrong
    const pointsChange = isCorrect ? 1 : -1

    // Update score
    await supabase.from('players').update({
      score: buzzedPlayer.score + pointsChange
    }).eq('id', buzzedPlayer.id)

    await supabase.from('rooms').update({ status: 'results' }).eq('id', roomId)
    fetchPlayers()
  }

  const handleNextRound = async () => {
    await startGame()
  }

  if (!roomId) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 text-white font-sans selection:bg-pink-500 overflow-hidden relative">

      {/* 
        TINY YouTube Player - Must be visible (1x1) so browser doesn't throttle background videos. 
        Using key={currentSong?.youtubeId} to force re-mounting and ensure Autoplay triggers cleanly.
      */}
      <div className="absolute top-0 left-0 w-1 h-1 overflow-hidden pointer-events-none opacity-10">
        <YouTube
          videoId={currentSong?.youtubeId}
          onReady={(e) => {
            playerRef.current = e.target;
            e.target.setVolume(100);
          }}
          onStateChange={(e) => {
            // Unstarted = -1, Ended = 0, Playing = 1, Paused = 2, Buffering = 3, Video cued = 5
            if (status === 'playing' && currentSong) {
              if (e.data === 5 || e.data === -1) {
                e.target.seekTo(currentSong.startAt, true);
                e.target.playVideo();
              }
            }
          }}
          opts={{
            height: '200',
            width: '200',
            playerVars: {
              autoplay: 1,
              controls: 0,
              disablekb: 1,
              start: currentSong?.startAt || 0,
              playsinline: 1
            }
          }}
        />
      </div>

      <div className="container mx-auto px-4 h-screen flex flex-col justify-center items-center py-12 relative z-10">

        {/* State: LOBBY */}
        {status === 'lobby' && (
          <div className="text-center w-full max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-700">
            <h1 className="text-6xl md:text-8xl font-black mb-8 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-blue-400">
              Music Party Game
            </h1>

            <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-12 border border-white/20 shadow-2xl mb-12">
              <p className="text-2xl font-medium text-purple-200 mb-4">Únete en tu celular ingresando este PIN:</p>
              <div className="text-8xl md:text-9xl font-mono font-black tracking-widest text-white mb-8">
                {pinCode}
              </div>
              <div className="flex items-center justify-center gap-3 text-xl">
                <Users className="w-8 h-8 text-blue-400" />
                <span>{players.length} Jugadores en la sala</span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
              {players.map(p => (
                <div key={p.id} className="bg-indigo-500/20 rounded-xl p-4 font-bold text-xl border border-indigo-400/30 animate-in zoom-in-50">
                  {p.name}
                </div>
              ))}
            </div>

            {players.length > 0 && (
              <div className="bg-white/5 rounded-3xl p-8 border border-white/10 max-w-2xl mx-auto backdrop-blur-md mb-8">
                <h3 className="text-2xl font-bold mb-6 text-purple-200">Elige la Categoría Musical:</h3>

                <div className="flex flex-wrap gap-3 justify-center mb-8">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.name}
                      onClick={() => {
                        setCategory(cat.name);
                        setCustomUrl(''); // Clear custom input when clicking a predefined option
                      }}
                      className={`px-4 py-2 rounded-full text-lg font-bold transition-all ${category === cat.name && customUrl === ''
                        ? 'bg-pink-500 text-white shadow-[0_0_15px_rgba(236,72,153,0.6)] scale-105'
                        : 'bg-white/10 text-indigo-200 hover:bg-white/20'
                        }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>

                <div className="mb-8 w-full max-w-md mx-auto">
                  <p className="text-sm text-indigo-300 mb-2 font-medium">¿O prefieres tu propia Playlist de YouTube?</p>
                  <input
                    type="text"
                    placeholder="Pega el link de la Playlist aquí..."
                    value={customUrl}
                    onChange={(e) => {
                      setCustomUrl(e.target.value)
                      if (e.target.value !== '') setCategory('Personalizada')
                    }}
                    className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/20 text-white placeholder-white/40 outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all text-center"
                  />
                </div>

                <button
                  onClick={startGame}
                  className="group bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-400 hover:to-violet-400 text-white px-12 py-6 rounded-full text-3xl font-black shadow-[0_0_40px_rgba(236,72,153,0.5)] transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-4 mx-auto w-full"
                >
                  <Play className="w-10 h-10 fill-current group-hover:animate-pulse" />
                  EMPEZAR JUEGO
                </button>
              </div>
            )}
          </div>
        )}

        {/* State: PLAYING */}
        {status === 'playing' && (
          <div className="text-center animate-in zoom-in duration-500">
            <div className="relative w-64 h-64 mx-auto mb-12">
              <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-20"></div>
              <div className="absolute inset-4 bg-purple-500 rounded-full animate-pulse opacity-40"></div>
              <div className="absolute inset-8 bg-indigo-600 rounded-full flex items-center justify-center shadow-[0_0_60px_rgba(79,70,229,0.5)]">
                <Music className="w-24 h-24 text-white animate-bounce" />
              </div>
            </div>
            <h2 className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-200 to-indigo-200">
              Escuchando la pista...
            </h2>
            <p className="mt-8 text-2xl text-slate-400 max-w-2xl mx-auto">
              El primero en presionar el botón de su celular tendrá que cantar o adivinar la canción.
            </p>
          </div>
        )}

        {/* State: BUZZED */}
        {status === 'buzzed' && buzzedPlayer && (
          <div className="text-center w-full animate-in zoom-in-75 duration-300">
            <h2 className="text-9xl font-black text-rose-500 drop-shadow-[0_0_80px_rgba(244,63,94,0.6)] animate-pulse">
              ¡ALTO!
            </h2>
            <div className="mt-12 bg-white/10 rounded-3xl p-16 backdrop-blur-sm border-4 border-rose-500/50 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-rose-500/20 to-purple-500/20 animate-pulse"></div>
              <p className="text-5xl font-bold text-white relative z-10">
                <span className="text-rose-400 uppercase tracking-wider">{buzzedPlayer.name}</span> TIENE LA PALABRA
              </p>
            </div>
            <p className="mt-12 text-3xl text-purple-200 animate-bounce">
              ¡A cantar! 🎤
            </p>
          </div>
        )}

        {/* State: VOTING */}
        {status === 'voting' && buzzedPlayer && (
          <div className="text-center w-full max-w-4xl">
            <h2 className="text-6xl font-bold mb-12">
              ¿Le achuntó {buzzedPlayer.name}?
            </h2>

            <div className="grid grid-cols-2 gap-12 mb-16">
              <div className="bg-emerald-500/20 rounded-3xl p-12 border-4 border-emerald-500/50 flex flex-col items-center">
                <Check className="w-32 h-32 text-emerald-400 mb-6" />
                <span className="text-6xl font-black text-emerald-100">{votes.correct}</span>
                <span className="text-2xl mt-4 text-emerald-300 font-bold uppercase tracking-widest">Correcto</span>
              </div>

              <div className="bg-rose-500/20 rounded-3xl p-12 border-4 border-rose-500/50 flex flex-col items-center">
                <X className="w-32 h-32 text-rose-400 mb-6" />
                <span className="text-6xl font-black text-rose-100">{votes.wrong}</span>
                <span className="text-2xl mt-4 text-rose-300 font-bold uppercase tracking-widest">Incorrecto</span>
              </div>
            </div>

            <div className="flex flex-col items-center gap-6">
              <p className="text-2xl text-purple-200">
                Voten en sus celulares ({votes.correct + votes.wrong} / {players.length - 1} votos)
              </p>
              <button
                onClick={showResults}
                className="bg-white text-indigo-900 px-8 py-4 rounded-xl text-2xl font-bold hover:bg-slate-200 transition"
              >
                Cerrar Votación y Ver Resultados
              </button>
            </div>
          </div>
        )}

        {/* State: RESULTS */}
        {status === 'results' && currentSong && (
          <div className="w-full max-w-6xl flex gap-12 items-center animate-in slide-in-from-bottom-12 duration-700">

            <div className="flex-1 bg-white/5 rounded-3xl p-10 backdrop-blur-md border border-white/10">
              <h3 className="text-3xl font-bold mb-6 text-purple-300 flex items-center gap-3">
                <Trophy className="w-8 h-8 text-yellow-400" />
                Ranking Final
              </h3>
              <div className="flex flex-col gap-4">
                {players.map((p, i) => (
                  <div key={p.id} className="flex justify-between items-center bg-black/20 p-4 rounded-xl">
                    <div className="flex items-center gap-4">
                      <span className="text-2xl font-black text-white/40">#{i + 1}</span>
                      <span className="text-2xl font-bold">{p.name}</span>
                    </div>
                    <span className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-yellow-300 to-orange-400">
                      {p.score} pts
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col items-center text-center">
              <p className="text-3xl font-medium mb-8">
                {votes.correct >= votes.wrong ? (
                  <span className="text-emerald-400">¡La mayoría votó Correcto!✅<br />+1 Punto para {buzzedPlayer?.name}</span>
                ) : (
                  <span className="text-rose-400">¡La mayoría votó Incorrecto!❌<br />-1 Punto para {buzzedPlayer?.name}</span>
                )}
              </p>

              <div className="relative group overflow-hidden rounded-2xl shadow-2xl shadow-purple-500/20 mb-8 border-4 border-white/20">
                <img
                  src={currentSong.artworkUrl100.replace('100x100', '400x400')}
                  alt="Album Artwork"
                  className="w-80 h-80 object-cover"
                />
              </div>

              <h3 className="text-4xl font-black mb-2">{currentSong.trackName}</h3>
              <p className="text-2xl text-purple-300 mb-12">{currentSong.artistName}</p>

              <button
                onClick={handleNextRound}
                className="bg-gradient-to-r from-blue-500 to-indigo-600 px-10 py-5 rounded-full text-2xl font-bold shadow-lg hover:scale-105 transition"
              >
                Siguiente Ronda ➔
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  )
}
