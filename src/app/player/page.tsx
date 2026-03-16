'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Loader2, Music, Check, X, Bell } from 'lucide-react'

type RoomStatus = 'lobby' | 'playing' | 'buzzed' | 'voting' | 'results';

export default function PlayerPage() {
  const [pin, setPin] = useState('')
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState<string | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  
  const [status, setStatus] = useState<RoomStatus>('lobby')
  const [buzzedPlayerId, setBuzzedPlayerId] = useState<string | null>(null)
  const [buzzedPlayerName, setBuzzedPlayerName] = useState<string | null>(null)
  const [hasVoted, setHasVoted] = useState(false)
  const [error, setError] = useState('')
  const [isExcluded, setIsExcluded] = useState(false)

  // Realtime Subscription
  useEffect(() => {
    if (!roomId || !playerId) return

    const roomChannel = supabase
      .channel('public:room_player')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, 
        async (payload) => {
          const room = payload.new as any
          
          // Detect fresh round vs rebound
          if (room.status === 'playing') {
            // If we came from 'voting', it means somebody was evaluated.
            // If it was ME, I should be excluded from this rebound.
            if (status === 'voting' && buzzedPlayerId === playerId) {
              setIsExcluded(true)
            } else if (status === 'lobby' || status === 'results') {
              // Completely new round
              setIsExcluded(false)
            }
            // Reset base flags
            setHasVoted(false)
            setBuzzedPlayerId(null)
          }
          
          if (room.status === 'lobby') {
             setIsExcluded(false)
          }

          setStatus(room.status)
          
          if (room.status === 'buzzed' && room.buzzed_player_id) {
            setBuzzedPlayerId(room.buzzed_player_id)
            if (room.buzzed_player_id !== playerId) {
              const { data } = await supabase.from('players').select('name').eq('id', room.buzzed_player_id).single()
              setBuzzedPlayerName(data?.name || 'Otro jugador')
            }
          }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(roomChannel)
    }
  }, [roomId, playerId, status, buzzedPlayerId])

  const joinRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (!pin || !name) {
      setError('Por favor ingresa PIN y Nombre')
      return
    }

    try {
      // 1. Find Room
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('id, status')
        .eq('pin_code', pin)
        .single()

      if (roomError || !room) {
        setError('PIN incorrecto o sala no encontrada')
        return
      }
      
      if (room.status !== 'lobby') {
        setError('El juego ya empezó en esta sala')
        return
      }

      // 2. Insert Player
      const { data: playerData, error: playerError } = await supabase
        .from('players')
        .insert([{ room_id: room.id, name }])
        .select()
        .single()

      if (playerError || !playerData) {
        setError('Error al unirse a la sala')
        return
      }

      setRoomId(room.id)
      setPlayerId(playerData.id)
      setStatus('lobby')
      
    } catch (err) {
      setError('Error inesperado')
    }
  }

  const handleBuzz = async () => {
    if (status !== 'playing') return
    
    // Attempt to update the room
    const { data: currentRoom } = await supabase
      .from('rooms')
      .select('status, buzzed_player_id')
      .eq('id', roomId)
      .single()
      
    // Defensive check
    if (currentRoom?.status !== 'playing' || currentRoom?.buzzed_player_id) return
    
    // Buzz! Fire and forget. Let Realtime trigger the UI update to ensure fairness.
    await supabase.from('rooms').update({ 
      status: 'buzzed', 
      buzzed_player_id: playerId 
    }).eq('id', roomId).eq('status', 'playing')
    // We added .eq('status', 'playing') so if another player already flipped it to buzzed on the server in the last 10ms, this fails silently.
  }

  const handleVote = async (isCorrect: boolean) => {
    if (hasVoted) return
    
    await supabase.from('votes').insert([{
      room_id: roomId,
      voter_id: playerId,
      is_correct: isCorrect
    }])
    
    await supabase.from('players').update({ has_voted: true }).eq('id', playerId)
    setHasVoted(true)
  }

  // Not joined yet
  if (!roomId || !playerId) {
    return (
      <div className="min-h-[100dvh] bg-slate-900 flex flex-col items-center justify-center p-6 font-sans text-white">
        <div className="w-full max-w-sm bg-white/10 p-8 rounded-3xl border border-white/20 backdrop-blur-lg shadow-2xl">
          <div className="flex justify-center mb-8">
            <div className="bg-indigo-500 p-4 rounded-full">
              <Music className="w-10 h-10 text-white" />
            </div>
          </div>
          
          <h1 className="text-3xl font-black text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-indigo-400">
            Únete al Juego
          </h1>
          
          {error && (
            <div className="bg-rose-500/20 text-rose-300 p-3 rounded-lg mb-6 text-sm text-center border border-rose-500/50">
              {error}
            </div>
          )}
          
          <form onSubmit={joinRoom} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-indigo-300 mb-1">PIN de la sala</label>
              <input 
                type="number" 
                value={pin}
                onChange={e => setPin(e.target.value)}
                className="w-full bg-black/30 border border-indigo-500/50 rounded-xl px-4 py-4 text-center text-3xl font-mono tracking-widest text-white placeholder-slate-600 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                placeholder="1234"
                maxLength={4}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-indigo-300 mb-1">Tu Apodo</label>
              <input 
                type="text" 
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-black/30 border border-indigo-500/50 rounded-xl px-4 py-4 text-center text-xl text-white placeholder-slate-600 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                placeholder="Ej: JP, Maria, etc."
                maxLength={15}
              />
            </div>
            
            <button 
              type="submit"
              className="w-full mt-4 bg-gradient-to-r from-indigo-500 to-purple-600 py-4 rounded-xl font-bold text-lg hover:opacity-90 active:scale-95 transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)]"
            >
              ENTRAR
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Active game views (Mobile First)
  return (
    <div className="min-h-[100dvh] bg-slate-900 text-white font-sans overflow-hidden flex flex-col">
      
      {/* Header Info */}
      <div className="p-4 bg-black/40 border-b border-white/10 flex justify-between items-center text-sm font-medium">
        <span className="text-indigo-300">Sala: <span className="text-white">{pin}</span></span>
        <span className="text-indigo-300">{name}</span>
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        
        {/* State: LOBBY */}
        {status === 'lobby' && (
          <div className="text-center animate-in zoom-in duration-500">
            <Loader2 className="w-16 h-16 text-indigo-500 animate-spin mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-white mb-2">¡Estás dentro!</h2>
            <p className="text-indigo-300">Mira la pantalla principal.<br/>El host está por empezar la ronda.</p>
          </div>
        )}

        {/* State: PLAYING (Buzzer) */}
        {status === 'playing' && !isExcluded && (
          <button 
            onPointerDown={(e) => {
              e.preventDefault(); // Prevent ghost clicks
              handleBuzz();
            }}
            className="w-72 h-72 md:w-96 md:h-96 rounded-full bg-gradient-to-br from-rose-500 to-rose-700 shadow-[0_20px_0_rgb(159,18,57),0_0_80px_rgba(244,63,94,0.6)] border-[12px] border-rose-400 active:shadow-[0_4px_0_rgb(159,18,57)] active:translate-y-[16px] transition-all duration-100 flex flex-col items-center justify-center gap-4 group cursor-pointer touch-none select-none"
          >
            <Bell className="w-24 h-24 text-white group-hover:scale-110 transition-transform pointer-events-none" />
            <span className="text-5xl font-black text-white uppercase tracking-widest drop-shadow-md pointer-events-none">Apretar</span>
          </button>
        )}

        {status === 'playing' && isExcluded && (
          <div className="text-center animate-in zoom-in duration-500 bg-black/40 p-8 rounded-3xl border border-rose-500/30">
            <X className="w-16 h-16 text-rose-500 mx-auto mb-6" />
            <h2 className="text-3xl font-bold text-white mb-2">Eliminado</h2>
            <p className="text-indigo-300">Te equivocaste en esta ronda.<br/>Espera a que alguien más adivine o pase el tiempo.</p>
          </div>
        )}

        {/* State: BUZZED */}
        {status === 'buzzed' && (
          <div className="text-center w-full">
            {buzzedPlayerId === playerId ? (
              <div className="animate-in zoom-in-75 duration-300">
                <div className="w-48 h-48 bg-rose-500 rounded-full mx-auto flex items-center justify-center mb-8 shadow-[0_0_60px_rgba(244,63,94,0.5)]">
                  <Music className="w-20 h-20 text-white animate-bounce" />
                </div>
                <h2 className="text-4xl font-black text-rose-500 mb-4">¡Fuiste tú!</h2>
                <p className="text-xl text-indigo-200">Prepárate para cantar y ser juzgado.</p>
              </div>
            ) : (
              <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 w-full animate-in slide-in-from-bottom-8">
                <span className="text-lg text-slate-400 uppercase tracking-widest font-bold block mb-4">Apretó:</span>
                <span className="text-4xl font-black text-white break-words">{buzzedPlayerName}</span>
                <p className="mt-8 text-indigo-300">Esperando que cante...</p>
              </div>
            )}
          </div>
        )}

        {/* State: VOTING */}
        {status === 'voting' && (
          <div className="w-full flex flex-col h-full justify-center">
            {buzzedPlayerId === playerId ? (
               <div className="text-center bg-indigo-900/50 p-8 rounded-3xl border border-indigo-500/30">
                 <Loader2 className="w-12 h-12 text-indigo-400 animate-spin mx-auto mb-6" />
                 <h2 className="text-2xl font-bold mb-2">¡Todos están votando!</h2>
                 <p className="text-indigo-300">Cruza los dedos...</p>
               </div>
            ) : hasVoted ? (
               <div className="text-center bg-slate-800 p-8 rounded-3xl border border-slate-700">
                 <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Check className="w-10 h-10 text-emerald-500" />
                 </div>
                 <h2 className="text-2xl font-bold">Voto registrado</h2>
                 <p className="text-slate-400 mt-2">Mira la pantalla principal.</p>
               </div>
            ) : (
               <div className="flex flex-col gap-6 w-full">
                 <h2 className="text-2xl font-bold text-center mb-4">¿Lo hizo bien?</h2>
                 <button 
                  onClick={() => handleVote(true)}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-3xl p-8 flex items-center justify-center gap-4 active:scale-95 transition-transform border-[6px] border-emerald-400 shadow-[0_10px_0_rgb(6,95,70)]"
                 >
                   <Check className="w-16 h-16 text-white" />
                   <span className="text-4xl font-black text-white">SÍ</span>
                 </button>
                 
                 <button 
                  onClick={() => handleVote(false)}
                  className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 rounded-3xl p-8 flex items-center justify-center gap-4 active:scale-95 transition-transform border-[6px] border-rose-400 shadow-[0_10px_0_rgb(159,18,57)]"
                 >
                   <X className="w-16 h-16 text-white" />
                   <span className="text-4xl font-black text-white">NO</span>
                 </button>
               </div>
            )}
          </div>
        )}

        {/* State: RESULTS */}
        {status === 'results' && (
           <div className="text-center w-full bg-slate-800/80 p-10 rounded-3xl border border-white/10 animate-in slide-in-from-bottom-8">
             <h2 className="text-3xl font-black mb-6">¡Ronda Terminada!</h2>
             <p className="text-xl text-indigo-300 mb-8">Mira el ranking en la pantalla principal o espera la siguiente ronda.</p>
             <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mx-auto opacity-50" />
           </div>
        )}

      </div>
    </div>
  )
}
