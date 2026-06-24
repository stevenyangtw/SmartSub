import { useState, useRef, useEffect } from 'react';
import ReactPlayer from 'react-player';
import { Subtitle } from './useSubtitles';

// 格式化時間為 MM:SS 格式
export const formatTime = (seconds: number): string => {
  if (!seconds && seconds !== 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// 二分查找當前時間命中的字幕：字幕按 startTimeInSeconds 有序，
// 找最後一個 start <= time 的行，再驗證 end > time
const findSubtitleIndexAtTime = (subs: Subtitle[], time: number): number => {
  let lo = 0;
  let hi = subs.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((subs[mid].startTimeInSeconds ?? 0) <= time) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate === -1) return -1;
  return (subs[candidate].endTimeInSeconds ?? 0) > time ? candidate : -1;
};

export const useVideoPlayer = (
  mergedSubtitles: Subtitle[],
  currentSubtitleIndex: number,
  setCurrentSubtitleIndex: (index: number) => void,
) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const playerRef = useRef<ReactPlayer>(null);

  // 根據當前播放時間查找活躍字幕（二分索引，避免每個進度 tick 線性掃全表）
  useEffect(() => {
    if (currentTime >= 0 && mergedSubtitles.length > 0) {
      const index = findSubtitleIndexAtTime(mergedSubtitles, currentTime);
      if (index !== -1 && index !== currentSubtitleIndex) {
        // 僅更新索引；滾動統一交給 SubtitleList 的自動滾動 effect 處理，
        // 避免兩處 scrollIntoView 同時觸發導致滾動位置衝突
        setCurrentSubtitleIndex(index);
      }
    }
  }, [currentTime, mergedSubtitles]);

  // 播放器進度更新
  const handleProgress = ({ playedSeconds }) => {
    setCurrentTime(playedSeconds);
  };

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  // 點擊字幕跳轉到對應時間點
  const handleSubtitleClick = (index: number) => {
    if (index >= 0 && index < mergedSubtitles.length) {
      // 無論是否有影片，都要更新當前字幕索引
      setCurrentSubtitleIndex(index);

      // 如果有影片播放器，跳轉到對應時間點
      if (playerRef.current) {
        const startTime = mergedSubtitles[index]?.startTimeInSeconds ?? 0;
        // 增加微小偏移（10ms），避免正好落在前後字幕的邊界時間點上
        // 這樣可以確保影片播放器的字幕軌道只顯示當前字幕
        // 必須顯式傳入 'seconds'：react-player 在 amount∈(0,1) 且未指定 type 時
        // 會把它當作「百分比」跳轉（duration * amount），導致第一條字幕(<1s)跳到影片末尾
        playerRef.current.seekTo(startTime + 0.01, 'seconds');
      }
    }
  };

  // 跳轉到下一個字幕
  const goToNextSubtitle = () => {
    const nextIndex = Math.min(
      currentSubtitleIndex + 1,
      mergedSubtitles.length - 1,
    );
    if (nextIndex !== currentSubtitleIndex && nextIndex >= 0) {
      handleSubtitleClick(nextIndex);
    }
  };

  // 跳轉到上一個字幕
  const goToPreviousSubtitle = () => {
    const prevIndex = Math.max(currentSubtitleIndex - 1, 0);
    if (prevIndex !== currentSubtitleIndex) {
      handleSubtitleClick(prevIndex);
    }
  };

  // 快進快退
  const seekVideo = (seconds: number) => {
    if (playerRef.current) {
      const currentTime = playerRef.current.getCurrentTime();
      // 同樣顯式傳入 'seconds'，避免快進/快退到 (0,1) 秒區間時被當作百分比跳轉
      playerRef.current.seekTo(currentTime + seconds, 'seconds');
    }
  };

  // 播放速度控制
  const changePlaybackRate = (delta: number) => {
    const newRate = Math.max(0.25, Math.min(2, playbackRate + delta));
    setPlaybackRate(newRate);
  };

  return {
    currentTime,
    duration,
    setDuration,
    isPlaying,
    playbackRate,
    playerRef,
    handleProgress,
    togglePlay,
    handleSubtitleClick,
    goToNextSubtitle,
    goToPreviousSubtitle,
    seekVideo,
    changePlaybackRate,
    setPlaybackRate,
  };
};
