import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Repository } from 'typeorm';
import type { Queue } from 'bull';
import { Video } from '../../entities/video.entity';
import { Projeto } from '../../entities/projeto.entity';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { TranscriptionService } from '../transcription/transcription.service';
import { VIDEO_QUEUE, VideoJobType } from '../queue/queue.constants';
import { TenantDbManager } from '../tenant/tenant-db.manager';

export interface ClipPreferences {
  aspect_ratio: string;
  proporcao_tela?: string;
  min_clips: number;
  max_clips: number;
  analysis_start?: number;
  analysis_end?: number;
}

const DEFAULT_PREFERENCES: ClipPreferences = {
  aspect_ratio: '9:16',
  proporcao_tela: '9:16',
  min_clips: 1,
  max_clips: 1,
  analysis_start: 0,
  analysis_end: 0,
};

@Injectable()
export class VideosService {
  constructor(
    @InjectQueue(VIDEO_QUEUE) private videoQueue: Queue,
    private tenantDb: TenantDbManager,
    private transcriptionService: TranscriptionService,
  ) { }

  private async getVideosRepo(usuarioId: string): Promise<Repository<Video>> {
    const ds = await this.tenantDb.getTenantDataSource(usuarioId);
    return ds.getRepository(Video);
  }

  private async getProjetosRepo(usuarioId: string): Promise<Repository<Projeto>> {
    const ds = await this.tenantDb.getTenantDataSource(usuarioId);
    return ds.getRepository(Projeto);
  }

  async findAll(usuarioId: string, projetoId?: string): Promise<Video[]> {
    const repo = await this.getVideosRepo(usuarioId);
    const qb = repo.createQueryBuilder('video')
      .innerJoin('video.projeto', 'projeto', 'projeto.usuario_id = :usuarioId', { usuarioId })
      .leftJoinAndSelect('video.cortes', 'cortes');

    if (projetoId) {
      qb.andWhere('video.projeto_id = :projetoId', { projetoId });
    }

    qb.orderBy('video.criado_em', 'DESC');
    return qb.getMany();
  }

  async findOne(usuarioId: string, id: string): Promise<Video> {
    const repo = await this.getVideosRepo(usuarioId);
    const video = await repo.createQueryBuilder('video')
      .innerJoin('video.projeto', 'projeto', 'projeto.usuario_id = :usuarioId', { usuarioId })
      .leftJoinAndSelect('video.cortes', 'cortes')
      .leftJoinAndSelect('video.legendas', 'legendas')
      .where('video.id = :id', { id })
      .getOne();

    if (!video) throw new NotFoundException(`Video ${id} não encontrado`);
    return video;
  }

  async importFromYoutube(usuarioId: string, projetoId: string, youtubeUrl: string, preferences?: any): Promise<Video> {
    const projetoRepo = await this.getProjetosRepo(usuarioId);
    const projeto = await projetoRepo.findOne({ where: { id: projetoId, usuario_id: usuarioId } });
    if (!projeto) throw new NotFoundException('Projeto inválido');

    const youtubeId = this.extractYoutubeId(youtubeUrl);
    if (!youtubeId) throw new BadRequestException('URL do YouTube inválida');

    const metadata = await this.fetchYoutubeMetadata(youtubeId);

    // Clean URL: strip playlist/radio params, keep only video ID
    const cleanUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

    const videoRepo = await this.getVideosRepo(usuarioId);
    const prefs: ClipPreferences = {
      ...DEFAULT_PREFERENCES,
      ...(preferences || {}),
    };

    const video = videoRepo.create({
      id: uuidv4(),
      projeto_id: projetoId,
      titulo: metadata.title,
      tipo_fonte: 'youtube',
      url_fonte: cleanUrl,
      youtube_id: youtubeId,
      miniatura_youtube: metadata.thumbnail,
      criador: metadata.creator,
      visualizacoes: metadata.views,
      curtidas: metadata.likes,
      comentarios: metadata.comments,
      duracao: metadata.duration,
      status_transcricao: 'draft',
      status_analise: 'draft',
      preferencias_corte: prefs as any,
    });
    const saved = await videoRepo.save(video);

    // Auto-trigger full processing (analysis + rendering) for Link imports
    return this.startProcessing(usuarioId, saved.id, prefs, false);
  }

  async getYoutubeMetadata(url: string): Promise<any> {
    const youtubeId = this.extractYoutubeId(url);
    if (!youtubeId) throw new BadRequestException('URL do YouTube inválida');
    return this.fetchYoutubeMetadata(youtubeId);
  }

  async uploadVideo(usuarioId: string, projetoId: string, file: Express.Multer.File): Promise<Video> {
    const projetoRepo = await this.getProjetosRepo(usuarioId);
    const projeto = await projetoRepo.findOne({ where: { id: projetoId, usuario_id: usuarioId } });
    if (!projeto) throw new NotFoundException('Projeto inválido');

    const videoRepo = await this.getVideosRepo(usuarioId);
    const video = videoRepo.create({
      id: uuidv4(),
      projeto_id: projetoId,
      titulo: file.originalname.replace(/\.[^/.]+$/, ''),
      tipo_fonte: 'upload',
      caminho_arquivo: file.path,
      status_transcricao: 'draft',
      status_analise: 'draft',
      preferencias_corte: DEFAULT_PREFERENCES,
    });
    return videoRepo.save(video);
  }

  async startProcessing(usuarioId: string, videoId: string, preferences: ClipPreferences, analysisOnly = false): Promise<Video> {
    const video = await this.findOne(usuarioId, videoId);

    const prefs: ClipPreferences = {
      ...DEFAULT_PREFERENCES,
      ...preferences,
    };

    // Normalize aspect ratio mapping (Frontend uses aspect_ratio, Backend uses proporcao_tela)
    if ((preferences as any).aspect_ratio && !prefs.proporcao_tela) {
      prefs.proporcao_tela = (preferences as any).aspect_ratio;
    }


    const videoRepo = await this.getVideosRepo(usuarioId);
    await videoRepo.update(videoId, {
      preferencias_corte: prefs as any,
      status_transcricao: 'pending',
      status_analise: 'pending'
    });

    if (video.tipo_fonte === 'youtube') {
      await this.videoQueue.add(VideoJobType.DOWNLOAD_YOUTUBE,
        { videoId, youtubeUrl: video.url_fonte, preferences: prefs, usuarioId, analysisOnly },
        { jobId: `yt-${videoId}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
      );
    } else if (video.caminho_arquivo) {
      await this.videoQueue.add(VideoJobType.PROCESS_UPLOADED,
        { videoId, filePath: video.caminho_arquivo, preferences: prefs, usuarioId, analysisOnly },
        { jobId: `upload-${videoId}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
      );
    }
    return this.findOne(usuarioId, videoId);
  }

  async uploadAudioForVideo(usuarioId: string, videoId: string, file: Express.Multer.File): Promise<Video> {
    const video = await this.findOne(usuarioId, videoId);
    const videoRepo = await this.getVideosRepo(usuarioId);

    await videoRepo.update(videoId, {
      caminho_arquivo: file.path,
      status_transcricao: 'processing',
      status_analise: 'pending'
    });

    const prefs = video.preferencias_corte || DEFAULT_PREFERENCES;
    await this.videoQueue.add(VideoJobType.PROCESS_UPLOADED,
      { videoId, filePath: file.path, preferences: prefs, usuarioId },
      { jobId: `audio-${videoId}-${Date.now()}` }
    );
    return this.findOne(usuarioId, videoId);
  }

  async getJobStatus(usuarioId: string, videoId: string): Promise<any> {
    // First try to get live job info from queue
    const jobs = await this.videoQueue.getJobs(['active', 'waiting', 'delayed', 'failed', 'completed']);
    const job = jobs.find((j) => j.data?.videoId === videoId);

    // Also read DB status for accurate progress mapping
    const video = await this.findOne(usuarioId, videoId).catch(() => null);
    const transcriptStatus = video?.['status_transcricao'] ?? (video as any)?.transcript_status;
    const analysisStatus = video?.['status_analise'] ?? (video as any)?.analysis_status;

    // Derive progress from DB status when no live job found
    let progress = 0;
    let message = '';
    let status = 'not_in_queue';

    if (transcriptStatus === 'pending' || transcriptStatus === 'processing') {
      progress = transcriptStatus === 'processing' ? 35 : 10;
      message = transcriptStatus === 'processing' ? 'Transcrevendo áudio...' : 'Baixando vídeo...';
      status = 'active';
    } else if (transcriptStatus === 'completed' && (analysisStatus === 'pending' || analysisStatus === 'processing')) {
      progress = analysisStatus === 'processing' ? 70 : 60;
      message = 'Analisando com IA...';
      status = 'active';
    } else if (analysisStatus === 'completed') {
      // Check if clips are still rendering
      const ds = await this.tenantDb.getTenantDataSource(usuarioId);
      const repo = ds.getRepository(require('../../entities/corte.entity').Corte);
      const clips = await repo.find({ where: { video_id: videoId } });
      const allDone = clips.length > 0 && clips.every((c: any) => c.status === 'completed' || c.status === 'done');
      const anyPending = clips.some((c: any) => c.status === 'pending' || c.status === 'processing');

      if (anyPending) {
        progress = 88;
        message = `Renderizando clipes (${clips.filter((c: any) => c.status === 'completed' || c.status === 'done').length}/${clips.length})...`;
        status = 'active';
      } else if (allDone) {
        progress = 100;
        message = 'Concluído!';
        status = 'completed';
      } else if (clips.length === 0) {
        progress = 85;
        message = 'Criando clipes...';
        status = 'active';
      }
    } else if (transcriptStatus === 'error' || analysisStatus === 'error') {
      status = 'failed';
      message = 'Erro no processamento';
    }

    // Override with live queue data if available and more up to date
    if (job) {
      const jobState = await job.getState();
      const jobProgress = job.progress();
      if (typeof jobProgress === 'number' && jobProgress > 0) {
        progress = jobProgress;
      }
      if (jobState === 'failed') {
        status = 'failed';
        message = job.failedReason || 'Erro';
      } else if (jobState === 'completed') {
        status = 'completed';
      } else if (jobState === 'active' || jobState === 'waiting') {
        status = 'active';
      }
    }

    return { status, progress, message };
  }

  async update(usuarioId: string, id: string, data: Partial<Video>): Promise<Video> {
    await this.findOne(usuarioId, id); // Ensure ownership
    const videoRepo = await this.getVideosRepo(usuarioId);
    await videoRepo.update(id, data);
    return this.findOne(usuarioId, id);
  }

  async remove(usuarioId: string, id: string): Promise<void> {
    const video = await this.findOne(usuarioId, id);

    // 1. Delete associated clips' physical files
    if (video.cortes && video.cortes.length > 0) {
      for (const clip of video.cortes) {
        if (clip.caminho_arquivo) {
          try {
            const fullPath = path.isAbsolute(clip.caminho_arquivo)
              ? clip.caminho_arquivo
              : path.resolve(process.cwd(), clip.caminho_arquivo);
            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
              console.log(`[videos] Deleted associated clip file: ${fullPath}`);
            }
          } catch (e) {
            console.warn(`[videos] Failed to delete clip file ${clip.caminho_arquivo}: ${e.message}`);
          }
        }
        if (clip.miniatura_caminho) {
          try {
            const thumbPath = path.isAbsolute(clip.miniatura_caminho)
              ? clip.miniatura_caminho
              : path.resolve(process.cwd(), clip.miniatura_caminho);
            if (fs.existsSync(thumbPath)) {
              fs.unlinkSync(thumbPath);
              console.log(`[videos] Deleted associated clip thumbnail: ${thumbPath}`);
            }
          } catch (e) {
            console.warn(`[videos] Failed to delete clip thumbnail ${clip.miniatura_caminho}: ${e.message}`);
          }
        }
      }
    }

    // 2. Delete main video file
    if (video.caminho_arquivo) {
      try {
        const fullPath = path.isAbsolute(video.caminho_arquivo)
          ? video.caminho_arquivo
          : path.resolve(process.cwd(), video.caminho_arquivo);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          console.log(`[videos] Deleted main video file: ${fullPath}`);
        }
      } catch (e) {
        console.warn(`[videos] Failed to delete video file ${video.caminho_arquivo}: ${e.message}`);
      }
    }

    // 3. Cleanup jobs
    try {
      const job = await this.videoQueue.getJob(`yt-${id}`);
      if (job) await job.remove();
    } catch { /* ignored */ }

    // 4. Delete from database (cascades to clips/subtitles)
    const videoRepo = await this.getVideosRepo(usuarioId);
    await videoRepo.delete(id);
  }

  async retriggerProcessing(usuarioId: string, id: string): Promise<Video> {
    const video = await this.findOne(usuarioId, id);
    const prefs = video.preferencias_corte || DEFAULT_PREFERENCES;

    if (video.tipo_fonte === 'youtube') {
      await this.videoQueue.add(VideoJobType.DOWNLOAD_YOUTUBE,
        { videoId: id, youtubeUrl: video.url_fonte, preferences: prefs, usuarioId },
        { jobId: `yt-retry-${id}-${Date.now()}` }
      );
    } else if (video.caminho_arquivo) {
      await this.videoQueue.add(VideoJobType.PROCESS_UPLOADED,
        { videoId: id, filePath: video.caminho_arquivo, preferences: prefs, usuarioId },
        { jobId: `upload-retry-${id}-${Date.now()}` }
      );
    }
    return video;
  }

  private extractYoutubeId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/shorts\/([^&\n?#]+)/
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  private async fetchYoutubeMetadata(youtubeId: string): Promise<any> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    try {
      const r = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { id: youtubeId, key: apiKey, part: 'snippet,statistics,contentDetails' }
      });
      const item = r.data.items?.[0];
      if (!item) throw new Error('Not found');
      return {
        title: item.snippet.title,
        creator: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.maxres?.url || item.snippet.thumbnails?.high?.url,
        views: parseInt(item.statistics.viewCount) || 0,
        likes: parseInt(item.statistics.likeCount) || 0,
        comments: parseInt(item.statistics.commentCount) || 0,
        duration: this.parseIsoDuration(item.contentDetails?.duration)
      };
    } catch {
      return {
        title: `YouTube Video ${youtubeId}`,
        creator: 'Unknown',
        thumbnail: `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`,
        views: 0,
        likes: 0,
        comments: 0,
        duration: 0
      };
    }
  }

  private parseIsoDuration(d: string): number {
    if (!d) return 0;
    const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || '0') * 3600) + (parseInt(m[2] || '0') * 60) + parseInt(m[3] || '0');
  }
}
