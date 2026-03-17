'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Play, Loader2, Music, Check, X, Users, Trophy, ClockAlert } from 'lucide-react'
import YouTube from 'react-youtube'
import { motion, AnimatePresence } from 'framer-motion'

// The Categories the Host can choose from
const CATEGORIES = [
  { name: 'Pop Hits 2026' },
  { name: 'Top 50 Chile' },
  { name: 'Rock de los 80' },
  { name: 'Reggaeton Antiguo' },
  { name: 'Anime Openings' },
  { name: 'Pop 2000s' },
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

  const [replayTimer, setReplayTimer] = useState<NodeJS.Timeout | null>(null)
  const [isPlayingReplay, setIsPlayingReplay] = useState<boolean>(false)
  const [roundTimer, setRoundTimer] = useState<number>(30)
  const [resultsTimer, setResultsTimer] = useState<number>(30)

  const roundIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const resultsIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isProcessingVoteRef = useRef(false)

  const [excludedPlayers, setExcludedPlayers] = useState<string[]>([])

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

          if (updatedRoom.status !== 'playing') {
            // Buzzed, voting, results... stop the 30s song timer
            clearRoundTimer()
          }

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
          setVotes(prev => {
            const nextVotes = {
              correct: prev.correct + (payload.new.is_correct ? 1 : 0),
              wrong: prev.wrong + (!payload.new.is_correct ? 1 : 0)
            }
            return nextVotes;
          })
        })
      .subscribe()

    return () => {
      supabase.removeChannel(playersChannel)
      supabase.removeChannel(roomChannel)
      supabase.removeChannel(votesChannel)
    }
  }, [roomId])

  // Effect to handle auto-advance or auto-rebound when all votes are cast
  useEffect(() => {
    if (status !== 'voting' || players.length <= 1) {
      isProcessingVoteRef.current = false;
      return;
    }

    if (isProcessingVoteRef.current) return;

    // Total players minus the one who buzzed
    const totalVoters = players.length - 1;
    const currentVotes = votes.correct + votes.wrong;

    if (currentVotes >= totalVoters && totalVoters > 0) {
      isProcessingVoteRef.current = true;
      // Auto-advance
      const isCorrect = votes.correct >= votes.wrong;

      if (isCorrect) {
        // Go directly to results
        showResults(true);
      } else {
        // Auto-rebound
        handleAutomaticRebound();
      }
    }
  }, [votes, players, status])

  const startRoundTimer = (reset: boolean = true) => {
    clearRoundTimer();
    if (reset) {
      setRoundTimer(30);
    }
    roundIntervalRef.current = setInterval(() => {
      setRoundTimer((prev) => {
        if (prev <= 1) {
          clearRoundTimer();
          handleRoundTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  const clearRoundTimer = () => {
    if (roundIntervalRef.current) {
      clearInterval(roundIntervalRef.current);
      roundIntervalRef.current = null;
    }
  }

  const startResultsTimer = () => {
    clearResultsTimer();
    setResultsTimer(30);
    resultsIntervalRef.current = setInterval(() => {
      setResultsTimer((prev) => {
        if (prev <= 1) {
          clearResultsTimer();
          handleNextRound();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  const clearResultsTimer = () => {
    if (resultsIntervalRef.current) {
      clearInterval(resultsIntervalRef.current);
      resultsIntervalRef.current = null;
    }
  }

  const handleRoundTimeout = async () => {
    if (!roomId) return;

    // Time is up, nobody guessed. Go directly to results.
    setStatus('results')

    if (playerRef.current && typeof playerRef.current.playVideo === 'function') {
      try { 
        playerRef.current.playVideo();
        setIsPlayingReplay(true);
      } catch (e) { }
    }

    await supabase.from('rooms').update({ status: 'results' }).eq('id', roomId)
    startResultsTimer()
  }

  const handleAutomaticRebound = async () => {
    if (!roomId || !buzzedPlayer) return

    clearRoundTimer()

    // Subtract score from buzzed player immediately without showing results screen
    await supabase.from('players').update({
      score: buzzedPlayer.score - 1
    }).eq('id', buzzedPlayer.id)

    const nextExcludedCount = excludedPlayers.length + 1
    setExcludedPlayers(prev => [...prev, buzzedPlayer.id])

    // Wait slightly so people see it
    setTimeout(async () => {
      if (nextExcludedCount >= players.length) {
        // Everyone has guessed incorrectly. End the round.
        if (playerRef.current && typeof playerRef.current.playVideo === 'function') {
          try { 
            playerRef.current.playVideo();
            setIsPlayingReplay(true);
          } catch (e) { }
        }

        await supabase.from('rooms').update({
          status: 'results',
          buzzed_player_id: null
        }).eq('id', roomId)

        setStatus('results')
        setBuzzedPlayer(null)
        setVotes({ correct: 0, wrong: 0 })
        fetchPlayers() // Refresh scores
        startResultsTimer()
      } else {
        // Return to playing state for the rebound
        await supabase.from('rooms').update({
          status: 'playing',
          buzzed_player_id: null
        }).eq('id', roomId)

        setStatus('playing')
        setBuzzedPlayer(null)
        setVotes({ correct: 0, wrong: 0 })
        fetchPlayers() // refresh scores since we deducted points

        // Resume video exactly from where it was
        if (playerRef.current && typeof playerRef.current.playVideo === 'function') {
          try {
            playerRef.current.playVideo()
          } catch (e) { console.error("Could not resume youtube", e) }
        }

        startRoundTimer(false)
      }
    }, 2000)
  }

  const fetchPlayers = async () => {
    if (!roomId) return
    const { data } = await supabase.from('players').select('*').eq('room_id', roomId).order('score', { ascending: false })
    if (data) setPlayers(data)
  }

  const startGame = async () => {
    try {
      setStatus('playing')
      setExcludedPlayers([])
      clearRoundTimer();
      setRoundTimer(30);

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

      startRoundTimer(true)

    } catch (e) {
      console.error("Error starting game", e)
      setStatus('lobby')
    }
  }

  const handleBuzzerPressed = async (playerId: string) => {
    // If we're already buzzed locally, ignore latecomers
    if (status === 'buzzed') return;

    setStatus('buzzed')

    if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
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
    // Moved to useEffect to access updated total count in state naturally
  }

  const showResults = async (isCorrectVote: boolean) => {
    if (!buzzedPlayer || !roomId) return

    setStatus('results')
    clearRoundTimer()

    const pointsChange = isCorrectVote ? 1 : 0

    if (pointsChange !== 0) {
      // Update score (only updates for correct. Wrong was updated during rebound)
      await supabase.from('players').update({
        score: buzzedPlayer.score + pointsChange
      }).eq('id', buzzedPlayer.id)
    }

    await supabase.from('rooms').update({ status: 'results' }).eq('id', roomId)
    fetchPlayers()
    startResultsTimer()

    // 3. Reproducción exacta si fue correcta
    if (isCorrectVote && playerRef.current && typeof playerRef.current.playVideo === 'function') {
      // It's already playing on Results because we don't pause it here explicitly. But let's assure it explicitly:
      try {
        playerRef.current.playVideo()
        setIsPlayingReplay(true)
      } catch (e) { console.error("Replay err", e) }
    } else {
      setIsPlayingReplay(false)
    }
  }

  const pauseReplay = () => {
    setIsPlayingReplay(false)
    if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
      try {
        playerRef.current.pauseVideo()
      } catch (e) { console.error("Pause replay err", e) }
    }
  }

  const handleNextRound = async () => {
    pauseReplay()
    clearResultsTimer()
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

      <div className="container mx-auto px-4 min-h-[100dvh] flex flex-col justify-center items-center py-6 relative z-10 w-full max-w-5xl">

        {/* State: LOBBY */}
        {status === 'lobby' && (
          <div className="text-center w-full max-w-6xl animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col justify-between h-full gap-4">

            {/* Cabecera */}
            <div>
              <h1 className="text-5xl md:text-7xl lg:text-8xl font-black md:mt-4 mb-2 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-blue-400 leading-tight">
                Adivina la Canción
              </h1>
            </div>

            {/* Fila principal: PIN a la izquierda, Categorías a la derecha (en pantallas grandes) */}
            <div className="flex flex-col md:flex-row gap-6 items-stretch w-full flex-1">

              {/* Columna Izquierda: PIN y Jugadores */}
              <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 shadow-2xl flex-1 flex flex-col justify-center">
                <p className="text-2xl lg:text-3xl font-medium text-purple-200 mb-4 whitespace-nowrap">Únete con el PIN:</p>
                <div className="text-8xl lg:text-[8rem] font-mono font-black tracking-widest text-white mb-6 leading-none">
                  {pinCode}
                </div>
                <div className="flex items-center justify-center gap-3 text-2xl bg-black/20 p-4 rounded-2xl mx-auto">
                  <Users className="w-8 h-8 text-blue-400" />
                  <span>{players.length} en la sala</span>
                </div>
              </div>

              {/* Columna Derecha: Categorías de juego */}
              {players.length > 0 && (
                <div className="bg-white/5 rounded-3xl p-8 border border-white/10 flex-[1.5] backdrop-blur-md flex flex-col justify-between h-full">
                  <div>
                    <h3 className="text-3xl font-bold mb-6 text-purple-200">Elige la Categoría:</h3>

                    <div className="flex flex-wrap gap-3 justify-center mb-6">
                      {CATEGORIES.map((cat) => (
                        <button
                          key={cat.name}
                          onClick={() => {
                            setCategory(cat.name);
                            setCustomUrl(''); // Clear custom input when clicking a predefined option
                          }}
                          className={`px-5 py-2.5 rounded-full text-xl font-bold transition-all whitespace-nowrap ${category === cat.name && customUrl === ''
                            ? 'bg-pink-500 text-white shadow-[0_0_20px_rgba(236,72,153,0.6)] scale-105'
                            : 'bg-white/10 text-indigo-200 hover:bg-white/20'
                            }`}
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="w-full">
                    <p className="text-base text-indigo-300 mb-3 font-medium">¿O prefieres tu propia Playlist de YouTube?</p>
                    <input
                      type="text"
                      placeholder="Pega el link de la Playlist aquí..."
                      value={customUrl}
                      onChange={(e) => {
                        setCustomUrl(e.target.value)
                        setCategory('') // deselect default categories
                      }}
                      className="w-full bg-black/40 border border-indigo-500/30 rounded-2xl px-6 py-4 text-white text-lg placeholder-indigo-400/50 focus:outline-none focus:ring-2 focus:ring-pink-500 transition-all text-center mb-6"
                    />

                    <button
                      onClick={startGame}
                      disabled={!category && !customUrl}
                      className="bg-gradient-to-r from-pink-500 to-violet-600 w-full py-5 rounded-2xl text-3xl font-black hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:hover:scale-100 uppercase tracking-wide shadow-[0_0_30px_rgba(236,72,153,0.5)] flex items-center justify-center gap-3"
                    >
                      <Play className="w-8 h-8" fill="currentColor" />
                      EMPEZAR JUEGO
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Fila Inferior: Grid de Jugadores interactivos */}
            <div className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-2 ${players.length === 0 ? 'opacity-0' : 'opacity-100'} transition-opacity`}>
              <AnimatePresence>
                {players.map(p => (
                  <motion.div
                    layout
                    transition={{ duration: 0.8, type: 'spring' }}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    key={p.id}
                    className="bg-indigo-500/20 rounded-xl p-3 font-bold text-xl border border-indigo-400/30 truncate"
                  >
                    {p.name}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

          </div>
        )}

        {/* State: PLAYING */}
        {status === 'playing' && (
          <div className="text-center animate-in zoom-in duration-500 flex flex-col items-center">

            <div className="text-4xl font-black mb-8 px-6 py-2 bg-black/40 rounded-full border border-white/10 text-pink-400">
              {roundTimer}s
            </div>

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
          <div className="text-center w-full max-w-5xl animate-in zoom-in-95 duration-700">
            <h2 className="text-4xl md:text-6xl lg:text-7xl font-black mb-16 text-white drop-shadow-xl inline-flex flex-wrap items-center justify-center gap-4">
              ¿Le achuntó 
              <span className="text-pink-400 bg-black/20 px-6 py-2 rounded-2xl truncate max-w-[50vw] inline-block align-bottom shadow-[0_0_20px_rgba(236,72,153,0.3)] border border-pink-500/20">
                {buzzedPlayer.name}
              </span>?
            </h2>

            <div className="flex flex-col md:flex-row gap-8 md:gap-16 mb-16 justify-center">
              <div className="flex-1 bg-gradient-to-br from-emerald-500/10 to-emerald-900/40 rounded-[3rem] p-12 border border-emerald-500/30 shadow-[0_0_50px_rgba(16,185,129,0.2)] backdrop-blur-md flex flex-col items-center relative overflow-hidden group">
                <div className="absolute inset-0 bg-emerald-400/10 translate-y-full group-hover:translate-y-0 transition-transform duration-500"></div>
                <Check className="w-40 h-40 text-emerald-400 mb-6 drop-shadow-[0_0_30px_rgba(52,211,153,0.8)]" />
                <span className="text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-emerald-100 to-emerald-400 drop-shadow-2xl">{votes.correct}</span>
                <span className="text-3xl mt-6 text-emerald-300 font-bold uppercase tracking-widest">Correcto</span>
              </div>

              <div className="flex-1 bg-gradient-to-br from-rose-500/10 to-rose-900/40 rounded-[3rem] p-12 border border-rose-500/30 shadow-[0_0_50px_rgba(244,63,94,0.2)] backdrop-blur-md flex flex-col items-center relative overflow-hidden group">
                <div className="absolute inset-0 bg-rose-400/10 translate-y-full group-hover:translate-y-0 transition-transform duration-500"></div>
                <X className="w-40 h-40 text-rose-400 mb-6 drop-shadow-[0_0_30px_rgba(251,113,133,0.8)]" />
                <span className="text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-rose-100 to-rose-400 drop-shadow-2xl">{votes.wrong}</span>
                <span className="text-3xl mt-6 text-rose-300 font-bold uppercase tracking-widest">Incorrecto</span>
              </div>
            </div>

            <div className="flex flex-col items-center w-full max-w-3xl mx-auto">
              <div className="w-full mb-4">
                <div className="flex justify-between text-xl text-purple-200 font-bold mb-3 uppercase tracking-wider">
                  <span className="animate-pulse">Esperando votos...</span>
                  <span>{votes.correct + votes.wrong} / {players.length - 1}</span>
                </div>
                {/* Progress bar container */}
                <div className="w-full h-6 bg-black/40 rounded-full overflow-hidden border border-white/10 p-1">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-pink-500 to-indigo-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${((votes.correct + votes.wrong) / Math.max(1, players.length - 1)) * 100}%` }}
                    transition={{ type: "spring", stiffness: 50 }}
                  />
                </div>
              </div>

              {votes.wrong > votes.correct && (votes.correct + votes.wrong) >= (players.length - 1) && (
                <div className="text-3xl font-bold text-rose-400 animate-pulse mt-8 flex items-center gap-4 bg-rose-500/20 px-8 py-4 rounded-full border border-rose-500/30">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  Mayoría incorrecta. ¡Preparando rebote!
                </div>
              )}
            </div>
          </div>
        )}

        {/* State: RESULTS */}
        {status === 'results' && currentSong && (
          <div className="w-full max-w-7xl flex flex-col lg:flex-row gap-12 lg:gap-16 items-center lg:items-stretch animate-in zoom-in-95 duration-700">

            {/* Columna Izquierda: Ranking/Posiciones */}
            <div className="flex-1 bg-gradient-to-br from-white/10 to-transparent rounded-[3rem] p-10 backdrop-blur-xl border border-white/20 shadow-[0_0_50px_rgba(255,255,255,0.05)] flex flex-col">
              <h3 className="text-4xl font-black mb-8 text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-pink-300 flex items-center gap-4 justify-center lg:justify-start drop-shadow-lg">
                <Trophy className="w-10 h-10 text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.8)]" />
                POSICIONES
              </h3>
              <div className="flex flex-col gap-4 flex-1">
                <AnimatePresence>
                  {players.map((p, i) => (
                    <motion.div
                      layout
                      transition={{ duration: 0.8, type: 'spring' }}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={p.id}
                      className="flex justify-between items-center bg-white/5 hover:bg-white/10 transition-colors p-5 rounded-2xl border border-white/5 relative overflow-hidden group"
                    >
                      {/* Efecto hover sutil en el fondo del jugador */}
                      <div className="absolute inset-0 bg-gradient-to-r from-pink-500/10 to-transparent translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-500"></div>
                      
                      <div className="flex items-center gap-5 relative z-10">
                        <span className={`text-4xl font-black ${i === 0 ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-white/30'}`}>
                          #{i + 1}
                        </span>
                        <span className="text-3xl font-bold text-white truncate max-w-[200px]">{p.name}</span>
                      </div>
                      <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-orange-400 relative z-10">
                        {p.score} pts
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>

            {/* Columna Derecha: Resultado y Canción */}
            <div className="flex-[1.5] flex flex-col items-center text-center justify-between">
              
              {/* Banner de Resultado */}
              <div className="w-full max-w-2xl mb-10">
                {!buzzedPlayer ? (
                  <div className="bg-amber-500/10 border-2 border-amber-500/50 rounded-3xl p-6 shadow-[0_0_40px_rgba(245,158,11,0.3)] animate-pulse flex items-center justify-center gap-4">
                    <ClockAlert className="w-10 h-10 text-amber-400" />
                    <span className="text-4xl font-black text-amber-400 block tracking-wide">¡Nadie adivinó a tiempo!</span>
                  </div>
                ) : votes.correct >= votes.wrong ? (
                  <div className="bg-emerald-500/10 border-2 border-emerald-500/50 rounded-3xl p-6 shadow-[0_0_50px_rgba(16,185,129,0.3)] relative overflow-hidden flex items-center justify-center gap-6">
                    <div className="absolute inset-0 bg-gradient-to-r from-emerald-400/0 via-emerald-400/20 to-emerald-400/0 animate-[shimmer_2s_infinite]"></div>
                    <Check className="w-16 h-16 text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.8)] relative z-10" />
                    <div className="text-left relative z-10">
                      <span className="text-4xl font-black text-emerald-400 block mb-1 leading-tight drop-shadow-md">¡Veredicto Correcto!</span>
                      <span className="text-2xl text-emerald-200 font-bold">+1 Punto para {buzzedPlayer.name}</span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-rose-500/10 border-2 border-rose-500/50 rounded-3xl p-6 shadow-[0_0_50px_rgba(244,63,94,0.3)] flex items-center justify-center gap-6">
                    <X className="w-16 h-16 text-rose-400 drop-shadow-[0_0_15px_rgba(251,113,133,0.8)]" />
                    <div className="text-left">
                      <span className="text-4xl font-black text-rose-400 block tracking-wide drop-shadow-md">¡Equivocado!</span>
                      <span className="text-2xl text-rose-200 font-bold">-1 Punto para {buzzedPlayer.name}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Cover Art Gigante Flotante */}
              <div className="relative group mb-10 w-full max-w-md flex justify-center">
                {/* Glow trasero */}
                <div className="absolute inset-0 bg-pink-500/30 blur-[100px] rounded-full group-hover:bg-indigo-500/40 transition-colors duration-700"></div>
                <div className="relative overflow-hidden rounded-[2rem] shadow-2xl border border-white/20 animate-[float_6s_ease-in-out_infinite]">
                  <img
                    src={currentSong.artworkUrl100.replace('100x100', '600x600')}
                    alt="Album Artwork"
                    className="w-80 h-80 lg:w-96 lg:h-96 object-cover transform group-hover:scale-105 transition-transform duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"></div>
                  
                  {/* Textos dentro de la carátula en parte inferior */}
                  <div className="absolute bottom-0 left-0 right-0 p-8 text-left">
                    <h3 className="text-3xl lg:text-4xl font-black mb-2 text-white drop-shadow-lg leading-tight line-clamp-2">{currentSong.trackName}</h3>
                    <p className="text-xl lg:text-2xl text-pink-300 font-bold drop-shadow-md truncate">{currentSong.artistName}</p>
                  </div>
                </div>
              </div>

              {/* Botón Siguiente Ronda Extendido */}
              <div className="w-full max-w-2xl px-4 mt-auto">
                <button
                  onClick={handleNextRound}
                  className="group relative w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 p-1 rounded-3xl shadow-[0_0_40px_rgba(79,70,229,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <div className="absolute inset-0 bg-white/20 rounded-3xl blur-md group-hover:bg-white/30 transition-colors"></div>
                  <div className="relative bg-black/20 backdrop-blur-sm rounded-[1.4rem] px-8 py-6 flex items-center justify-between">
                    <span className="text-3xl font-black text-white tracking-wide">SIGUIENTE RONDA</span>
                    <div className="flex items-center gap-4">
                      <span className="bg-white/10 text-blue-200 px-4 py-2 rounded-2xl text-2xl font-bold font-mono">
                        {resultsTimer}s
                      </span>
                      <div className="bg-white/20 p-2 rounded-full">
                        <Play className="w-8 h-8 text-white fill-current group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  )
}
