
import { useState, useEffect, useRef, useCallback } from 'react';

export const useTimer = (durationSeconds: number, onEnd: () => void) => {
  const [remainingTime, setRemainingTime] = useState(durationSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const timerRef = useRef<number | null>(null);

  const endTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRunning(false);
    onEnd();
  }, [onEnd]);

  useEffect(() => {
    if (isRunning && remainingTime > 0) {
      timerRef.current = window.setInterval(() => {
        setRemainingTime(prevTime => {
          if (prevTime <= 1) {
            endTimer();
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);
    } else if (remainingTime <= 0 && isRunning) {
        endTimer();
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRunning, remainingTime, endTimer]);

  const start = useCallback(() => setIsRunning(true), []);
  const pause = useCallback(() => setIsRunning(false), []);

  const setTime = useCallback((newTime: number) => {
    if(!isRunning) {
        setRemainingTime(newTime);
    }
  }, [isRunning]);

  return { remainingTime, start, pause, isRunning, setTime };
};
