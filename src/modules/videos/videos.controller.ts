import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseInterceptors, UploadedFile, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { VideosService } from './videos.service';
import { sanitizePath } from '../../common/utils/path-utils';

const storage = diskStorage({
  destination: process.env.UPLOAD_DIR || 'uploads',
  filename: (_, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`),
});

/** Maps PT-BR entity fields to the English aliases the frontend expects */
function mapVideo(v: any) {
  if (!v) return v;
  return {
    ...v,
    title: v.titulo,
    youtube_thumbnail: v.miniatura_youtube,
    file_path: sanitizePath(v.caminho_arquivo),
    creator: v.criador,
    views: v.visualizacoes,
    likes: v.curtidas,
    comments: v.comentarios,
    duration: v.duracao,
    transcript_status: v.status_transcricao,
    analysis_status: v.status_analise,
    youtube_id: v.youtube_id,
    source_type: v.tipo_fonte,
    source_url: v.url_fonte,
    project_id: v.projeto_id,
    transcript_id: v.id_transcricao,
    transcript_text: v.texto_transcricao,
    transcript_words: v.palavras_transcricao,
    analysis_result: v.resultado_analise,
    cut_preferences: v.preferencias_corte,
    created_at: v.criado_em,
    updated_at: v.atualizado_em,
    // map nested clips too
    clips: v.cortes?.map((c: any) => ({
      ...c,
      id: c.id,
      video_id: c.video_id,
      title: c.titulo,
      start_time: c.tempo_inicio,
      end_time: c.tempo_fim,
      viral_score: c.pontuacao_viral,
      score: c.pontuacao_viral,
      justification: c.justificativa,
      ai_reason: c.justificativa,
      status: c.status,
      aspect_ratio: c.proporcao_tela,
      file_path: sanitizePath(c.caminho_arquivo),
      output_path: sanitizePath(c.caminho_arquivo),
      thumbnail_path: sanitizePath(c.miniatura_caminho),
    })) ?? v.clips,
  };
}

@Controller('api/videos')
@UseGuards(JwtAuthGuard)
export class VideosController {
  constructor(private readonly videosService: VideosService) { }

  @Get()
  async findAll(@Query('projectId') projectId: any, @Request() req) {
    let pId = Array.isArray(projectId) ? projectId[0] : projectId;
    if (typeof pId === 'string') pId = pId.trim();
    if (pId === 'null' || pId === 'undefined' || pId === '') pId = undefined;
    const videos = await this.videosService.findAll(req.user.id, pId);
    return videos.map(mapVideo);
  }

  @Get('youtube-metadata')
  async getYoutubeMetadata(@Query('url') url: string) {
    return this.videosService.getYoutubeMetadata(url);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    const cid = id ? String(id).trim() : '';
    if (!cid || cid === 'null' || cid === 'undefined' || cid === '{id}' || cid === '{videoId}') {
      throw new BadRequestException('Invalid video ID');
    }
    const v = await this.videosService.findOne(req.user.id, cid);
    return mapVideo(v);
  }

  @Get(':id/job-status')
  getJobStatus(@Param('id') id: string, @Request() req) {
    const cid = id ? String(id).trim() : '';
    if (!cid || cid === 'null' || cid === 'undefined' || cid === '{id}' || cid === '{videoId}') {
       throw new BadRequestException('Invalid video ID');
    }
    return this.videosService.getJobStatus(req.user.id, cid);
  }

  @Post('import-youtube')
  async importYoutube(@Body() body: { projectId: string; url: string; preferences?: any }, @Request() req) {
    const v = await this.videosService.importFromYoutube(req.user.id, body.projectId, body.url, body.preferences);
    return mapVideo(v);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }))
  async uploadVideo(@UploadedFile() file: Express.Multer.File, @Body('projectId') projectId: string, @Request() req) {
    const v = await this.videosService.uploadVideo(req.user.id, projectId, file);
    return mapVideo(v);
  }

  @Post(':id/start-processing')
  async startProcessing(@Param('id') id: string, @Body() preferences: any, @Request() req) {
    const v = await this.videosService.startProcessing(req.user.id, id, preferences);
    return mapVideo(v);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any, @Request() req) {
    const v = await this.videosService.update(req.user.id, id, body);
    return mapVideo(v);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.videosService.remove(req.user.id, id);
  }

  @Post(':id/reprocess')
  retrigger(@Param('id') id: string, @Request() req) {
    return this.videosService.retriggerProcessing(req.user.id, id);
  }

  @Post(':id/upload-audio')
  @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }))
  uploadAudio(@UploadedFile() file: Express.Multer.File, @Param('id') id: string, @Request() req) {
    return this.videosService.uploadAudioForVideo(req.user.id, id, file);
  }
}
