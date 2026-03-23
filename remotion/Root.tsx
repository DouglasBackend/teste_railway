// @ts-nocheck
import { Composition } from 'remotion';
import { MainEngine } from './MainEngine';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VideoEngine"
        component={MainEngine}
        durationInFrames={300} // Dynamic override based on input video
        fps={30} // Same fps as raw cut
        width={1080}
        height={1920}
        defaultProps={{
          videoUrl: '', 
          words: [],
          subtitleStyle: { preset: 'tiktok' }
        }}
      />
    </>
  );
};
