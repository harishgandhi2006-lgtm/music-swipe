import { useEffect, useRef, useState } from 'react';

export function useAudio(track) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [needsGesture, setNeedsGesture] = useState(false);

  // Initialize audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    audio.addEventListener('timeupdate', () => {
      if (audio.duration) {
        setProgress(audio.currentTime / audio.duration);
      }
    });
    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
    });
    audio.addEventListener('ended', () => setIsPlaying(false));
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Load new track when it changes
  useEffect(() => {
    if (!track || !audioRef.current) return;
    const audio = audioRef.current;

    audio.pause();
    audio.src = track.preview_url;
    audio.playbackRate = speed;
    setProgress(0);
    setIsPlaying(false);
    setNeedsGesture(false);

    audio.play().then(() => {
      setIsPlaying(true);
      setNeedsGesture(false);
    }).catch((err) => {
      if (err.name === 'NotAllowedError') {
        setNeedsGesture(true);
      }
    });
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update playback speed without reloading
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  function toggle() {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().then(() => setNeedsGesture(false));
    } else {
      audioRef.current.pause();
    }
  }

  function seekTo(fraction) {
    if (!audioRef.current || !audioRef.current.duration) return;
    audioRef.current.currentTime = audioRef.current.duration * fraction;
  }

  return { isPlaying, toggle, speed, setSpeed, progress, duration, needsGesture, seekTo };
}
