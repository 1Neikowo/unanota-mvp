import Link from 'next/link'
import { Monitor, Smartphone, Music } from 'lucide-react'

export default function Home() {
  return (
    <div className="min-h-[100dvh] bg-slate-900 flex flex-col items-center justify-center p-6 text-white overflow-hidden relative">
      
      {/* Background decoration */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-purple-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-50 animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-blue-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-50 animate-pulse" style={{ animationDelay: '2s' }}></div>

      <div className="relative z-10 w-full max-w-2xl text-center">
        <div className="bg-white/10 p-5 rounded-full inline-flex mb-8 border border-white/20 backdrop-blur-md">
          <Music className="w-12 h-12 text-pink-400" />
        </div>
        
        <h1 className="text-6xl md:text-8xl font-black mb-6 tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 drop-shadow-sm">
          Music Party
        </h1>
        
        <p className="text-2xl text-indigo-200 mb-16 font-medium">
          ¿Quién será el primero en adivinar la canción?
        </p>
        
        <div className="grid md:grid-cols-2 gap-6 w-full">
          <Link 
            href="/host"
            className="group relative bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600 hover:border-blue-400 p-8 rounded-3xl transition-all duration-300 hover:scale-[1.02] flex flex-col items-center justify-center gap-4 shadow-xl"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl"></div>
            <Monitor className="w-16 h-16 text-blue-400 group-hover:scale-110 transition-transform" />
            <h2 className="text-3xl font-bold text-white">Soy el Host</h2>
            <p className="text-slate-400">Proyecta esto en la TV o PC</p>
          </Link>

          <Link 
            href="/player"
            className="group relative bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600 hover:border-pink-400 p-8 rounded-3xl transition-all duration-300 hover:scale-[1.02] flex flex-col items-center justify-center gap-4 shadow-xl"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-pink-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl"></div>
            <Smartphone className="w-16 h-16 text-pink-400 group-hover:scale-110 transition-transform" />
            <h2 className="text-3xl font-bold text-white">Soy Jugador</h2>
            <p className="text-slate-400">Únete desde tu celular</p>
          </Link>
        </div>
      </div>
      
    </div>
  )
}
