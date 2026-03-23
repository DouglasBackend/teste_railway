import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Corte as Clip } from '../../entities/corte.entity';
import { Video } from '../../entities/video.entity';
import { Legenda as Subtitle } from '../../entities/legenda.entity';
import { EventsGateway } from '../gateway/events.gateway';
import { RemotionRendererService } from './remotion-renderer.service';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { CLIP_EXPORT_QUEUE, ClipJobType } from '../queue/queue.constants';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { TenantDbManager } from '../tenant/tenant-db.manager';

const execAsync = promisify(exec);

export interface ExportOptions {
  resolution?: '480p' | '1080p';
  proporcao_tela?: string;
  aspect_ratio?: string;
  isFinalExport?: boolean;
}

@Injectable()
export class ClipsService {

  constructor(
    private eventsGateway: EventsGateway,
    private tenantDb: TenantDbManager,
    private remotionRenderer: RemotionRendererService,
    private readonly configService: ConfigService, // Injetar ConfigService
    @InjectQueue(CLIP_EXPORT_QUEUE) private exportQueue: Queue,
  ) { }

  private async clipsRepoFn(usuarioId: string) {
    const ds = await this.tenantDb.getTenantDataSource(usuarioId);
    return ds.getRepository(Clip);
  }

  private async videosRepoFn(usuarioId: string) {
    const ds = await this.tenantDb.getTenantDataSource(usuarioId);
    return ds.getRepository(Video);
  }

  private async subtitlesRepoFn(usuarioId: string) {
    const ds = await this.tenantDb.getTenantDataSource(usuarioId);
    return ds.getRepository(Subtitle);
  }

  async findAll(usuarioId: string, videoId?: string): Promise<Clip[]> {
    const clipsRepo = await this.clipsRepoFn(usuarioId);
    const where = videoId ? { video_id: videoId } : {};
    return clipsRepo.find({
      where,
      order: { pontuacao_viral: 'DESC', criado_em: 'DESC' },
    });
  }

  async findOne(usuarioId: string, id: string): Promise<Clip> {
    const clipsRepo = await this.clipsRepoFn(usuarioId);
    const clip = await clipsRepo.findOne({ where: { id } });
    if (!clip) throw new NotFoundException(`Clip ${id} not found`);
    return clip;
  }

  async createFromAnalysis(
    usuarioId: string,
    videoId: string,
    analysisClip: any,
  ): Promise<Clip> {
    const clipsRepo = await this.clipsRepoFn(usuarioId);
    const start = analysisClip.start_time ?? analysisClip.tempo_inicio;
    const end = analysisClip.end_time ?? analysisClip.tempo_fim;

    const clip = clipsRepo.create({
      id: uuidv4(),
      video_id: videoId,
      titulo: analysisClip.title || analysisClip.titulo,
      descricao: analysisClip.reason || analysisClip.descricao,
      tempo_inicio: start,
      tempo_fim: end,
      duracao: Number(end) - Number(start),
      proporcao_tela:
        analysisClip.aspect_ratio || analysisClip.proporcao_tela || '9:16',
      pontuacao_viral: Math.round(
        Number(analysisClip.score || analysisClip.pontuacao_viral || 0),
      ),
      justificativa: analysisClip.reason || analysisClip.justificativa,
      dados_legenda: {
        words: analysisClip.words || [],
        subtitle_preset: 'highlight', // Default preset fallback
      },
      status: 'pending',
    });
    const saved = await clipsRepo.save(clip);
    this.extractThumbnail(usuarioId, saved.id).catch(() => { });
    return saved;
  }

  async extractThumbnail(usuarioId: string, clipId: string) {
    const clipsRepo = await this.clipsRepoFn(usuarioId);
    const clip = await clipsRepo.findOne({
      where: { id: clipId },
      relations: ['video'],
    });
    if (!clip || !clip.video?.caminho_arquivo) return;

    const videoPath = clip.video.caminho_arquivo;
    const uploadDir = path.dirname(videoPath);
    const thumbName = `thumb_${clipId}.jpg`;
    const thumbPath = path.join(uploadDir, thumbName);

    try {
      const seekTime = clip.tempo_inicio + 0.1;
      await execAsync(
        `ffmpeg -ss ${seekTime} -i "${videoPath}" -vframes 1 -q:v 4 -y "${thumbPath}"`,
      );
      if (fs.existsSync(thumbPath)) {
        await clipsRepo.update(clipId, { miniatura_caminho: thumbPath });
        this.eventsGateway.emitClipReady(clip.video_id, {
          id: clipId,
          thumbnail_path: thumbName,
        });
      }
    } catch (e) {
      console.error(`[clips] Thumb fail: ${e.message}`);
    }
  }

  async createManual(
    usuarioId: string,
    videoId: string,
    data: any,
  ): Promise<Clip> {
    const clipsRepo = await this.clipsRepoFn(usuarioId);
    const clip = clipsRepo.create({
      id: uuidv4(),
      video_id: videoId,
      titulo: data.titulo,
      descricao: data.description,
      tempo_inicio: data.tempo_inicio,
      tempo_fim: data.tempo_fim,
      duracao: Number(data.tempo_fim) - Number(data.tempo_inicio),
      proporcao_tela: data.proporcao_tela || '9:16',
      pontuacao_viral: Math.round(Number(data.pontuacao_viral || 5)),
      status: 'pending',
    });
    const saved = await clipsRepo.save(clip);
    this.extractThumbnail(usuarioId, saved.id).catch(() => { });
    return saved;
  }

  async update(
    usuarioId: string,
    id: string,
    data: Partial<Clip>,
  ): Promise<Clip> {
    const clipsRepo = await this.clipsRepoFn(usuarioId);
    await clipsRepo.update(id, data);
    return this.findOne(usuarioId, id);
  }

  async remove(usuarioId: string, id: string): Promise<void> {
    const clipsRepo = await this.clipsRepoFn(usuarioId);
    const clip = await this.findOne(usuarioId, id);

    if (clip.caminho_arquivo) {
      try {
        const fullPath = path.isAbsolute(clip.caminho_arquivo)
          ? clip.caminho_arquivo
          : path.resolve(process.cwd(), clip.caminho_arquivo);

        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (e) {
        console.warn(`[clips] Failed to delete file: ${e.message}`);
      }
    }

    if (clip.miniatura_caminho) {
      try {
        const thumbPath = path.isAbsolute(clip.miniatura_caminho)
          ? clip.miniatura_caminho
          : path.resolve(process.cwd(), clip.miniatura_caminho);
        if (fs.existsSync(thumbPath)) {
          fs.unlinkSync(thumbPath);
        }
      } catch (e) {
        console.warn(`[clips] Failed to delete thumbnail: ${e.message}`);
      }
    }

    await clipsRepo.delete(id);
  }

  async exportClip(
    usuarioId: string,
    clipId: string,
    options: ExportOptions = {},
  ): Promise<Clip> {
    const clipsRepo = await this.clipsRepoFn(usuarioId);
    const clip = await this.findOne(usuarioId, clipId);

    const effectiveRatio = options.proporcao_tela || options.aspect_ratio;
    if (effectiveRatio) {
      await clipsRepo.update(clipId, { proporcao_tela: effectiveRatio });
      clip.proporcao_tela = effectiveRatio;
    }

    const videosRepo = await this.videosRepoFn(usuarioId);
    const video = await videosRepo.findOne({ where: { id: clip.video_id } });
    if (!video) throw new NotFoundException('Video not found');

    const inputFile = video.caminho_arquivo;
    if (!inputFile || !fs.existsSync(inputFile)) {
      throw new NotFoundException('Video file not found. Please ensure the video is downloaded.');
    }

    const envUploadDir = this.configService.get<string>('UPLOAD_DIR', 'uploads');
    const uploadDir = path.isAbsolute(envUploadDir)
      ? envUploadDir
      : path.resolve(process.cwd(), envUploadDir);

    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const outputFile = path.join(uploadDir, `clip_${clipId}.mp4`);
    const tempCut = path.join(uploadDir, `temp_cut_${clipId}.mp4`);
    const tempBase = path.join(uploadDir, `temp_base_${clipId}.mp4`);

    await clipsRepo.update(clipId, { status: 'processing' });
    this.eventsGateway.emitClipExportProgress(clipId, clip.video_id, 5);

    const safeUnlink = (p: string) => {
      try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
    };

    try {
      const inputPath = path.isAbsolute(inputFile) ? inputFile : path.resolve(process.cwd(), inputFile);

      // ── Step 1: FFmpeg — Cut raw segment ─────────────────────────
      const cutCmd = `ffmpeg -y -loglevel error -ss ${clip.tempo_inicio} -to ${clip.tempo_fim} -i "${inputPath}" -c copy -sn "${tempCut}"`;
      await execAsync(cutCmd, { timeout: 120000 });
      this.eventsGateway.emitClipExportProgress(clipId, clip.video_id, 25);

      // ── Step 2: FFmpeg — Geometry / Aspect ratio / Blur ──────────
      const is480p = options.resolution === '480p';
      const crf = 18;

      const { vfFilters, isComplex } = this.buildVideoFilters(
        clip.proporcao_tela,
        is480p,
        clip.dados_legenda
      );
      
      const filterFlag = isComplex ? '-filter_complex' : '-vf';
      const vfChain = isComplex ? vfFilters.join(';') : vfFilters.join(',');
      const finalVLabelArg = isComplex ? '[vout]' : '0:v';
      const filterArgs = `${filterFlag} "${vfChain}"`;
      const mapArgs = `-map "${finalVLabelArg}" -map 0:a? -sn`;

      const encodeCmd = [
        'ffmpeg', '-y', '-loglevel', 'error',
        `-i "${tempCut}"`,
        filterArgs, mapArgs,
        '-c:v libx264 -profile:v high -level 4.1',
        '-preset fast',
        `-crf ${crf}`,
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-c:a aac -ar 44100',
        `"${tempBase}"`,
      ].filter(Boolean).join(' ');

      await execAsync(encodeCmd, { timeout: 600000, cwd: uploadDir });
      this.eventsGateway.emitClipExportProgress(clipId, clip.video_id, 55);

      // ── Step 3: Remotion — Subtitle overlay ──────────────────────
      const words = clip.dados_legenda?.words || [];
      const hasSubtitles = words.length > 0;

      if (hasSubtitles && options.isFinalExport) {
        // Adjust word timestamps to be relative to clip start (0-based)
        const clipStart = clip.tempo_inicio;
        const relativeWords = words.map((w: any) => ({
          text: w.text,
          start: Math.max(0, w.start - clipStart),
          end: Math.max(0, w.end - clipStart),
        }));

        const clipDuration = clip.tempo_fim - clip.tempo_inicio;
        const w = is480p ? 480 : (clip.proporcao_tela === '9:16' ? 1080 : (clip.proporcao_tela === '1:1' ? 1080 : 1920));
        const h = is480p ? 854 : (clip.proporcao_tela === '9:16' ? 1920 : (clip.proporcao_tela === '1:1' ? 1080 : 1080));

        await this.remotionRenderer.render({
          inputVideoPath: tempBase,
          outputPath: outputFile,
          words: relativeWords,
          subtitleStyle: clip.dados_legenda || {},
          durationSec: clipDuration,
          fps: 30,
          width: w,
          height: h,
        });
      } else {
        // No subtitles or not final export → just rename the base output
        fs.renameSync(tempBase, outputFile);
      }
      this.eventsGateway.emitClipExportProgress(clipId, clip.video_id, 95);

      safeUnlink(tempCut);
      safeUnlink(tempBase);

      const updateData: Partial<Clip> = { caminho_arquivo: outputFile, status: 'completed' };
      await clipsRepo.update(clipId, updateData);
      this.eventsGateway.emitClipExportProgress(clipId, clip.video_id, 100);
      this.eventsGateway.emitClipReady(clip.video_id, {
        id: clipId,
        caminho_arquivo: outputFile,
        status: 'completed',
      });

      return this.findOne(usuarioId, clipId);
    } catch (error) {
      console.error('Export pipeline error:', error.message);
      if (error.stderr) console.error('stderr:', error.stderr);

      safeUnlink(tempCut);
      safeUnlink(tempBase);

      await clipsRepo.update(clipId, { status: 'error' });
      this.eventsGateway.emitVideoError(clip.video_id, `Clip export failed: ${error.message}`);
      throw error;
    }
  }

  private buildVideoFilters(
    aspectRatio: string,
    is480p: boolean,
    style?: any,
  ): { vfFilters: string[]; isComplex: boolean } {
    const vfFilters: string[] = [];
    let isComplex = false;

    if (aspectRatio === '9:16') {
      const w = is480p ? 480 : 1080;
      const h = is480p ? 854 : 1920;

      const backgroundBlur = style?.background_blur !== undefined ? style.background_blur : 0;
      const videoScale = style?.video_scale !== undefined ? style.video_scale : 100;

      const blurSigma = Math.max(1, Math.round(backgroundBlur * (is480p ? 0.6 : 1)));
      const zoomFactor = videoScale / 100;

      const bgFilter = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},boxblur=${blurSigma}:1`;
      const fgFilter = `scale=${w * zoomFactor}:${h * zoomFactor}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`;

      vfFilters.push(
        `split=2[bg_916][fg_916]`,
        `[bg_916]${bgFilter}[blurred_916]`,
        `[fg_916]${fgFilter}[zoomed_916]`,
        `[blurred_916][zoomed_916]overlay=(W-w)/2:(H-h)/2[vout]`,
      );
      isComplex = true;
    } else if (aspectRatio === '1:1') {
      const d = is480p ? 480 : 1080;
      vfFilters.push(
        `scale=${d}:${d}:force_original_aspect_ratio=decrease:flags=lanczos`,
        `pad=${d}:${d}:(ow-iw)/2:(oh-ih)/2:black`,
      );
    } else {
      const w = is480p ? 854 : 1920;
      const h = is480p ? 480 : 1080;
      vfFilters.push(
        `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`,
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
      );
    }

    return { vfFilters, isComplex };
  }

  async createAllFromAnalysis(
    usuarioId: string,
    videoId: string,
    skipExport = false,
  ): Promise<Clip[]> {
    const videosRepo = await this.videosRepoFn(usuarioId);
    const clipsRepo = await this.clipsRepoFn(usuarioId);
    const video = await videosRepo.findOne({ where: { id: videoId } });
    if (!video?.resultado_analise?.clips) return [];

    const analysisClips = [...video.resultado_analise.clips].sort(
      (a: any, b: any) =>
        (b.score || b.pontuacao_viral || 0) -
        (a.score || a.pontuacao_viral || 0),
    );

    const validatedClips = this.deduplicateClips(analysisClips);

    const existingClips = await clipsRepo.find({
      where: { video_id: videoId },
    });
    if (existingClips.length > 0) {
      console.log(`[clips] Cleaning up ${existingClips.length} existing clips`);
    }

    for (const existing of existingClips) {
      try {
        if (existing.caminho_arquivo && fs.existsSync(existing.caminho_arquivo)) {
          fs.unlinkSync(existing.caminho_arquivo);
        }
        if (existing.miniatura_caminho && fs.existsSync(existing.miniatura_caminho)) {
          fs.unlinkSync(existing.miniatura_caminho);
        }
      } catch (e) {
        console.warn(`[clips] Could not delete clip assets: ${e.message}`);
      }
      await clipsRepo.delete(existing.id);
    }

    const prefs = video.preferencias_corte || {};
    const defaultAspect = prefs.proporcao_tela || '9:16';

    const clips: Clip[] = [];
    for (const analysisClip of validatedClips) {
      const start = parseFloat(analysisClip.start_time ?? analysisClip.tempo_inicio);
      const end = parseFloat(analysisClip.end_time ?? analysisClip.tempo_fim);

      const existingSame = await clipsRepo.findOne({
        where: { video_id: videoId, tempo_inicio: start, tempo_fim: end },
      });

      if (existingSame) {
        clips.push(existingSame);
        continue;
      }

      const allWords = video.palavras_transcricao || [];
      const clipWords = allWords.filter(w => {
        // AssemblyAI words are in ms, clip start/end are in seconds
        const wStartSec = w.start / 1000;
        const wEndSec = w.end / 1000;
        // Keep words that at least partially overlap the clip boundaries
        return wStartSec >= start - 0.5 && wEndSec <= end + 0.5;
      }).map(w => ({
        text: w.text,
        start: w.start / 1000,
        end: w.end / 1000,
      }));

      const clip = await this.createFromAnalysis(usuarioId, videoId, {
        ...analysisClip,
        words: clipWords,
        proporcao_tela: defaultAspect,
      });
      clips.push(clip);

      const exportOpts: ExportOptions = {
        resolution: '1080p',
        proporcao_tela: defaultAspect,
      };

      if (!skipExport) {
        this.exportQueue
          .add(ClipJobType.EXPORT_CLIP, {
            clipId: clip.id,
            options: exportOpts,
            usuarioId,
          })
          .catch((err) => {
            console.error(
              `Auto-export queue failed for clip ${clip.id}: ${err.message}`,
            );
          });
      }
    }
    return clips;
  }

  private deduplicateClips(clips: any[]): any[] {
    const result: any[] = [];
    for (const clip of clips) {
      const start = parseFloat(clip.start_time ?? clip.tempo_inicio) || 0;
      const end = parseFloat(clip.end_time ?? clip.tempo_fim) || 0;
      const duration = end - start;
      if (duration < 10) continue;

      const overlaps = result.some((accepted) => {
        const aStart = parseFloat(accepted.start_time ?? accepted.tempo_inicio) || 0;
        const aEnd = parseFloat(accepted.end_time ?? accepted.tempo_fim) || 0;
        return start < aEnd && end > aStart;
      });

      if (!overlaps) result.push(clip);
    }
    return result;
  }

  async updateMetadata(usuarioId: string, clipId: string, dto: any): Promise<Clip> {
    const repo = await this.clipsRepoFn(usuarioId);
    const clip = await repo.findOne({ where: { id: clipId } });
    if (!clip) throw new NotFoundException(`Clipe ${clipId} não encontrado`);

    if (dto.title !== undefined) clip.titulo = dto.title;

    if (dto.thumbnail_base64) {
      const base64Data = dto.thumbnail_base64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const thumbPath = path.join(path.dirname(clip.caminho_arquivo || ''), `thumb_${clip.id}_custom.jpg`);
      fs.writeFileSync(thumbPath, buffer);
      clip.miniatura_caminho = thumbPath;
    }

    const currentMeta = clip.dados_legenda
      ? typeof clip.dados_legenda === 'string'
        ? JSON.parse(clip.dados_legenda)
        : clip.dados_legenda
      : {};

    const editableFields = [
      'font_family', 'subtitle_preset', 'preset', 'font_color', 'highlight_color',
      'outline_color', 'outline_width', 'animation', 'posY', 'background_blur', 'shadow_depth', 'words',
      'max_words', 'font_size',
    ] as const;

    editableFields.forEach((field) => {
      if ((dto as any)[field] !== undefined) currentMeta[field] = (dto as any)[field];
    });

    if (dto.subtitle_preset) currentMeta.preset = dto.subtitle_preset;
    else if ((dto as any).preset) currentMeta.subtitle_preset = (dto as any).preset;

    clip.dados_legenda = currentMeta;
    return repo.save(clip);
  }
}
