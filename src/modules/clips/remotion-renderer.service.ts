import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
const ffmpegPath = require('ffmpeg-static');

@Injectable()
export class RemotionRendererService {
  private readonly logger = new Logger(RemotionRendererService.name);
  private bundleLocation: string | null = null;
  private browserReady = false;

  /**
   * Ensures the Chromium browser is downloaded and the Remotion
   * composition is bundled (webpack). Both operations are cached
   * after the first call so subsequent renders are fast.
   */
  async ensureReady(): Promise<void> {
    // 1) Browser
    if (!this.browserReady) {
      this.logger.log('Ensuring headless browser is available…');
      const { ensureBrowser } = await (Function(
        'return import("@remotion/renderer")',
      )() as Promise<typeof import('@remotion/renderer')>);
      await ensureBrowser();
      this.browserReady = true;
      this.logger.log('Browser OK ✓');
    }

    // 2) Bundle (webpack)
    if (!this.bundleLocation) {
      this.logger.log('Bundling Remotion composition…');
      const { bundle } = await (Function(
        'return import("@remotion/bundler")',
      )() as Promise<typeof import('@remotion/bundler')>);

      const entryPoint = path.resolve(process.cwd(), 'remotion', 'index.ts');
      this.bundleLocation = await bundle({
        entryPoint,
        webpackOverride: (cfg: any) => cfg,
      });
      this.logger.log(`Remotion bundle ready at ${this.bundleLocation}`);
    }
  }

  /**
   * Renders the base video with subtitle overlay via Remotion.
   *
   * @param inputVideoPath – Absolute path to the FFmpeg-processed video (already cut + geometry)
   * @param outputPath     – Where the final mp4 will be written
   * @param words          – Array of {text, start, end} with times RELATIVE TO CLIP (seconds)
   * @param subtitleStyle  – Styling object (preset, font_family, colors …)
   * @param durationSec    – Duration of the clip in seconds
   * @param width/height   – Resolution of the output
   */
  async render(opts: {
    inputVideoPath: string;
    outputPath: string;
    words: { text: string; start: number; end: number }[];
    subtitleStyle: Record<string, any>;
    durationSec: number;
    fps?: number;
    width?: number;
    height?: number;
  }): Promise<void> {
    await this.ensureReady();

    const { selectComposition, renderMedia } = await (Function(
      'return import("@remotion/renderer")',
    )() as Promise<typeof import('@remotion/renderer')>);

    const fps = opts.fps || 30;
    const durationInFrames = Math.ceil(opts.durationSec * fps);

    // Serve the video locally via HTTP to bypass Chromium file:// restrictions
    const http = require('http');
    const fs = require('fs');
    
    return new Promise((resolve, reject) => {
      const server = http.createServer((req: any, res: any) => {
        const stat = fs.statSync(opts.inputVideoPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(opts.inputVideoPath, { start, end });
          const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4',
            'Access-Control-Allow-Origin': '*'
          };
          res.writeHead(206, head);
          file.pipe(res);
        } else {
          const head = {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
            'Access-Control-Allow-Origin': '*'
          };
          res.writeHead(200, head);
          fs.createReadStream(opts.inputVideoPath).pipe(res);
        }
      });

      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        const videoUrl = `http://127.0.0.1:${port}/video.mp4`;

        const inputProps = {
          videoUrl,
          words: opts.words,
          subtitleStyle: opts.subtitleStyle,
        };

        this.logger.log(`Rendering ${durationInFrames} frames (${opts.durationSec.toFixed(1)}s @ ${fps}fps) via ${videoUrl} …`);

        try {
          const composition = await selectComposition({
            serveUrl: this.bundleLocation!,
            id: 'VideoEngine',
            inputProps,
          });

          composition.durationInFrames = durationInFrames;
          composition.fps = fps;
          composition.width = opts.width || 1080;
          composition.height = opts.height || 1920;

          await renderMedia({
            composition,
            serveUrl: this.bundleLocation!,
            codec: 'h264',
            outputLocation: opts.outputPath,
            inputProps,
            overwrite: true,
            chromiumOptions: {
              disableWebSecurity: true,
            },
            // @ts-ignore
            ffmpegExecutable: ffmpegPath,
            onProgress: ({ renderedFrames, encodedFrames }: any) => {
              if (renderedFrames % 15 === 0 || renderedFrames === durationInFrames) {
                this.logger.log(`Remotion Progress: Rendered ${renderedFrames} / ${durationInFrames} frames`);
              }
            }
          });

          this.logger.log(`Remotion render complete → ${opts.outputPath}`);
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          server.close();
        }
      });
    });
  }
}
