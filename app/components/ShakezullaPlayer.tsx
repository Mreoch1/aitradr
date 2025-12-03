"use client";

import { useState, useRef } from "react";

export function ShakezullaPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {isMinimized ? (
        // Minimized state - tiny button
        <button
          onClick={() => setIsMinimized(false)}
          className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-purple-600 bg-black text-lg shadow-lg transition-transform hover:scale-110"
          title="Show Shakezulla Player"
        >
          🎵
        </button>
      ) : (
        <div className="relative">
          {/* Close/Minimize button */}
          <button
            onClick={() => setIsMinimized(true)}
            className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-xs text-white hover:bg-gray-700"
            title="Minimize"
          >
            ×
          </button>
          
          <button
            onClick={togglePlay}
            className="group relative transition-transform hover:scale-110 active:scale-95"
            title="🎵 Shakezulla"
          >
            {/* Glow effect when playing */}
            {isPlaying && (
              <div className="absolute inset-0 animate-ping rounded-full bg-purple-500 opacity-75"></div>
            )}
            
            {/* Shakezulla Image - Smaller now */}
            <img
              src="/ShakeZulla.png"
              alt="Shakezulla"
              className={`relative h-14 w-14 rounded-full border-3 border-purple-600 bg-black shadow-2xl transition-all ${
                isPlaying ? "animate-pulse" : ""
              }`}
              style={{ imageRendering: 'pixelated', objectFit: 'cover' }}
            />
            
            {/* Play/Pause indicator */}
            <div className={`absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white shadow-lg transition-all ${
              isPlaying ? "bg-red-500" : "bg-green-500"
            }`}>
              <span className="text-xs text-white">
                {isPlaying ? "⏸" : "▶"}
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        src="/Aqua_Teen_Hunger_Force_OST_-_Intro_(mp3.pm).mp3"
        loop
        onEnded={() => setIsPlaying(false)}
      />
    </div>
  );
}

