// @ts-nocheck
import React from 'react';
import { AbsoluteFill, Video } from 'remotion';
import { SubtitleOverlay } from './SubtitleOverlay';

export const MainEngine: React.FC<{
  videoUrl: string;
  words: {text: string, start: number, end: number}[];
  subtitleStyle: any;
}> = ({ videoUrl, words, subtitleStyle }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {videoUrl && (
        <Video 
          src={videoUrl} 
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
        />
      )}
      
      <AbsoluteFill>
        <SubtitleOverlay words={words} style={subtitleStyle} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
