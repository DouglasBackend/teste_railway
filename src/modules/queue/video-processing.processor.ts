import {
  Process,
  Processor,
  OnQueueFailed,
  OnQueueCompleted,
} from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import type { Job } from 'bull';
import { Video } from '../../entities/video.entity';
import { Corte as Clip } from '../../entities/corte.entity';
import { TenantDbManager } from '../tenant/tenant-db.manager';
import { TranscriptionService } from '../transcription/transcription.service';
import { AnalysisService } from '../analysis/analysis.service';
import { AudioAnalysisService } from '../analysis/audio-analysis.service';
import { ClipsService } from '../clips/clips.service';
import { EventsGateway } from '../gateway/events.gateway';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

import { 
  VIDEO_QUEUE, 
  CLIP_EXPORT_QUEUE, 
  VideoJobType, 
  ClipJobType 
} from './queue.constants';

@Processor(VIDEO_QUEUE)
export class VideoProcessingProcessor {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    private transcriptionService: TranscriptionService,
    private analysisService: AnalysisService,
    private audioAnalysisService: AudioAnalysisService,
    private clipsService: ClipsService,
    private eventsGateway: EventsGateway,
    private tenantDb: TenantDbManager,
  ) {}

  private async getVideosRepo(usuarioId: string) {
    const ds = await this.tenantDb.getTenantDataSource(usuarioId);
    return ds.getRepository(Video);
  }

  @Process({ name: VideoJobType.DOWNLOAD_YOUTUBE, concurrency: 2 })
  async handleDownloadYoutube(job: Job<any>) {
    const { videoId, youtubeUrl, preferences, usuarioId } = job.data;
    const uploadDir =
      process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const videoPath = path.join(uploadDir, `${videoId}.mp4`);

    try {
      await job.progress(5);
      const vRepo = await this.getVideosRepo(usuarioId);
      await vRepo.update(videoId, { status_transcricao: 'processing' });
      this.eventsGateway.emitVideoProgress(videoId, 5, 'Baixando vídeo do YouTube...');

      // Clean URL
      let cleanUrl = youtubeUrl;
      try {
        const urlObj = new URL(youtubeUrl);
        const videoParam = urlObj.searchParams.get('v');
        if (videoParam) cleanUrl = `https://www.youtube.com/watch?v=${videoParam}`;
      } catch { /* keep original */ }

      const cookiesPath = path.join(process.cwd(), 'cookies.txt');
      const cookiesFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

      await new Promise<void>((resolve, reject) => {
        const format = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best';
        const command = `yt-dlp --no-playlist --retries 3 ${cookiesFlag} --user-agent "${userAgent}" -f "${format}" -o "${videoPath}" "${cleanUrl}"`;
        exec(command, { timeout: 600000 }, (error) => {
          if (error) return reject(error);
          resolve();
        });
      });

      if (!fs.existsSync(videoPath)) throw new Error('Download failed');

      await vRepo.update(videoId, { caminho_arquivo: videoPath });
      await job.progress(30);
      this.eventsGateway.emitVideoProgress(videoId, 30, 'Download concluído. Transcrevendo áudio...');

      await this.transcribeAndAnalyze(
        usuarioId, videoId, videoPath, job, preferences, job.data.analysisOnly,
      );
    } catch (error) {
      this.logger.error(`[${videoId}] YT download failed: ${error.message}`);
      const vRepo = await this.getVideosRepo(usuarioId);
      await vRepo.update(videoId, {
        status_transcricao: 'error',
        status_analise: 'error',
      });
      this.eventsGateway.emitVideoError(videoId, error.message);
      throw error;
    }
  }

  @Process({ name: VideoJobType.PROCESS_UPLOADED, concurrency: 3 })
  async handleProcessUploaded(job: Job<any>) {
    const { videoId, filePath, preferences, usuarioId } = job.data;

    try {
      const vRepo = await this.getVideosRepo(usuarioId);
      await vRepo.update(videoId, { status_transcricao: 'processing' });
      this.eventsGateway.emitVideoProgress(
        videoId,
        10,
        'Iniciando processamento...',
      );
      this.eventsGateway.emitVideoStatusChange(videoId, {
        transcript_status: 'processing',
      });
      await job.progress(10);

      await this.transcribeAndAnalyze(
        usuarioId,
        videoId,
        filePath,
        job,
        preferences,
        job.data.analysisOnly
      );
    } catch (error) {
      this.logger.error(`[${videoId}] Processing failed: ${error.message}`);
      const vRepo = await this.getVideosRepo(usuarioId);
      await vRepo.update(videoId, {
        status_transcricao: 'error',
        status_analise: 'error',
      });
      this.eventsGateway.emitVideoError(videoId, error.message);
      throw error;
    }
  }

  private async transcribeAndAnalyze(
    usuarioId: string,
    videoId: string,
    filePath: string,
    job: Job,
    preferences?: any,
    analysisOnly = false
  ) {
    const prefs = preferences || {};
    const doTranscription = prefs.generate_subtitles !== false;

    let transcriptionResult: any = { text: '', words: [] };
    const audioFeaturesPromise = this.audioAnalysisService
      .extractFeatures(filePath)
      .catch(() => null);

    const vRepo = await this.getVideosRepo(usuarioId);

    // ── Step: Transcrição (30% → 65%) ────────────────────────────────────────
    if (doTranscription) {
      await job.progress(32);
      this.eventsGateway.emitVideoProgress(videoId, 32, 'Transcrevendo áudio com AssemblyAI...');

      transcriptionResult = await this.transcriptionService.transcribe(filePath);

      await vRepo.update(videoId, {
        id_transcricao: transcriptionResult.id,
        texto_transcricao: transcriptionResult.text,
        palavras_transcricao: transcriptionResult.words,
        status_transcricao: 'completed',
        status_analise: 'processing',
      });
      await job.progress(65);
      this.eventsGateway.emitVideoProgress(videoId, 65, 'Transcrição concluída. Analisando com IA...');
      this.eventsGateway.emitVideoStatusChange(videoId, {
        transcript_status: 'completed',
        analysis_status: 'processing',
      });
    } else {
      await vRepo.update(videoId, {
        status_transcricao: 'skipped',
        status_analise: 'processing',
      });
      await job.progress(65);
      this.eventsGateway.emitVideoProgress(videoId, 65, 'Analisando com IA...');
    }

    // ── Step: Análise IA (65% → 85%) ─────────────────────────────────────────
    let audioFeatures = await audioFeaturesPromise;
    const video = await vRepo.findOne({ where: { id: videoId } });

    // ── Analysis Interval Filtering ──
    let filteredWords = transcriptionResult.words || [];
    let filteredText = transcriptionResult.text || '';
    
    const start = (prefs.analysis_start || 0);
    const end = (prefs.analysis_end || 0) > 0 ? prefs.analysis_end : 0;

    if (start > 0 || end > 0) {
      const startMs = start * 1000;
      const endMs = end > 0 ? end * 1000 : Infinity;

      this.logger.log(`[${videoId}] Filtering analysis interval: ${start}s to ${end > 0 ? end + 's' : 'end'}`);

      // Filter words
      filteredWords = filteredWords.filter(w => w.start >= startMs && w.end <= endMs);
      filteredText = filteredWords.map(w => w.text).join(' ');

      // Filter audio features if present
      if (audioFeatures) {
        if (audioFeatures.energy_peaks) {
          audioFeatures.energy_peaks = audioFeatures.energy_peaks.filter(p => p.timestamp >= start && (end === 0 || p.timestamp <= end));
        }
        if (audioFeatures.silence_segments) {
          audioFeatures.silence_segments = audioFeatures.silence_segments.filter(s => s.start >= start && (end === 0 || s.start <= end));
        }
      }
    }

    let analysis: any;
    if (video?.resultado_analise && !job.data.forceAnalysis) {
      this.logger.log(`[${videoId}] Analysis already exists, skipping.`);
      analysis = video.resultado_analise;
    } else {
      const clipsToGenerate = parseInt(process.env.CLIPS_TO_GENERATE || '3');
      analysis = await this.analysisService.analyzeTranscript(
        filteredText,
        filteredWords,
        video?.titulo || 'Video',
        video?.duracao || 0,
        audioFeatures,
        clipsToGenerate,
        clipsToGenerate,
      );
    }

    const vRepo2 = await this.getVideosRepo(usuarioId);
    await vRepo2.update(videoId, {
      resultado_analise: analysis,
      status_analise: 'completed',
    });
    await job.progress(85);
    this.eventsGateway.emitVideoProgress(videoId, 85, 'Análise concluída. Renderizando clipes...');
    this.eventsGateway.emitVideoStatusChange(videoId, {
      transcript_status: doTranscription ? 'completed' : 'skipped',
      analysis_status: 'completed',
      analysis_result: analysis,
    });

    // ── Step: Renderização (85% → 100%) ──────────────────────────────────────
    try {
      this.logger.log(`[${videoId}] Creating clips from analysis (forcing new clips)...`);
      await this.clipsService.createAllFromAnalysis(usuarioId, videoId, analysisOnly);
      this.eventsGateway.emitClipReady(videoId, { autoGenerated: true, analysisOnly });
    } catch (e) {
      this.logger.warn(`[${videoId}] Auto clip creation failed: ${e.message}`);
    }

    await job.progress(100);
    this.eventsGateway.emitVideoProgress(videoId, 100, 'Processamento concluído!');
    this.logger.log(`[${videoId}] Done.`);
  }

  @OnQueueFailed() onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.name}[${job.id}] failed: ${err.message}`);
  }
  @OnQueueCompleted() onCompleted(job: Job) {
    this.logger.log(`Job ${job.name}[${job.id}] completed`);
  }
}

@Processor(CLIP_EXPORT_QUEUE)
export class ClipExportProcessor {
  private readonly logger = new Logger(ClipExportProcessor.name);
  constructor(
    private clipsService: ClipsService,
    private eventsGateway: EventsGateway,
    private tenantDb: TenantDbManager,
  ) {}

  private async getCortesRepo(usuarioId: string) {
    const ds = await this.tenantDb.getTenantDataSource(usuarioId);
    return ds.getRepository(Clip);
  }

  @Process({ name: ClipJobType.EXPORT_CLIP, concurrency: 2 })
  async handleExportClip(job: Job<any>) {
    const { clipId, options, usuarioId } = job.data;
    try {
      await job.progress(5);
      await this.clipsService.exportClip(usuarioId, clipId, options);
      await job.progress(100);
    } catch (error) {
      this.logger.error(`[clip:${clipId}] Export failed: ${error.message}`);
      const cRepo = await this.getCortesRepo(usuarioId);
      await cRepo.update(clipId, { status: 'error' });
      throw error;
    }
  }

  @Process({ name: ClipJobType.CLEANUP_TEMP, concurrency: 1 })
  async handleCleanup(job: Job<any>) {
    const maxAge = (job.data.maxAgeHours || 24) * 3600 * 1000;
    const uploadDir =
      process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    const now = Date.now();
    let cleaned = 0;
    try {
      const files = fs.readdirSync(uploadDir);
      for (const file of files) {
        if (!file.startsWith('temp_') && !file.startsWith('sub_')) continue;
        const fullPath = path.join(uploadDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > maxAge) {
            fs.unlinkSync(fullPath);
            cleaned++;
          }
        } catch (fileErr) {
          // Skip if file is locked or inaccessible
          continue;
        }
      }
      this.logger.log(`Cleanup: removed ${cleaned} stale temp files`);
    } catch (e) {
      this.logger.warn(`Cleanup error: ${e.message}`);
    }
  }

  @OnQueueFailed() onFailed(job: Job, err: Error) {
    this.logger.error(`ClipExport job[${job.id}] failed: ${err.message}`);
  }
}
