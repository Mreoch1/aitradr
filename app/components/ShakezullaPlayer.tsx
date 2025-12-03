"use client";

import { useState, useRef } from "react";

export function ShakezullaPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
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
    <div className="fixed bottom-6 right-6 z-50">
      <button
        onClick={togglePlay}
        className="group relative transition-transform hover:scale-110 active:scale-95"
        title="🎵 Shakezulla"
      >
        {/* Glow effect when playing */}
        {isPlaying && (
          <div className="absolute inset-0 animate-ping rounded-full bg-purple-500 opacity-75"></div>
        )}
        
        {/* Shakezulla Image */}
        <img
          src="/ShakeZulla.png"
          alt="Shakezulla"
          className={`relative h-20 w-20 rounded-full border-4 border-purple-600 bg-black shadow-2xl transition-all ${
            isPlaying ? "animate-pulse" : ""
          }`}
          style={{ imageRendering: 'pixelated', objectFit: 'cover' }}
        />
        
        {/* Play/Pause indicator */}
        <div className={`absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow-lg transition-all ${
          isPlaying ? "bg-red-500" : "bg-green-500"
        }`}>
          <span className="text-xs text-white">
            {isPlaying ? "⏸" : "▶"}
          </span>
        </div>
      </button>

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

