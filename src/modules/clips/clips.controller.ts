import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Patch,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ClipsService } from './clips.service';
import { sanitizePath } from '../../common/utils/path-utils';

/** Maps PT-BR entity fields to the English aliases the frontend expects */
function mapClip(c: any) {
  if (!c) return c;
  return {
    ...c,
    title: c.titulo,
    description: c.descricao,
    start_time: c.tempo_inicio,
    end_time: c.tempo_fim,
    duration: c.duracao,
    viral_score: c.pontuacao_viral,
    score: c.pontuacao_viral,
    justification: c.justificativa,
    ai_reason: c.justificativa,
    file_path: sanitizePath(c.caminho_arquivo),
    output_path: sanitizePath(c.caminho_arquivo),
    thumbnail_path: sanitizePath(c.miniatura_caminho),
    subtitle_data: c.dados_legenda,
    aspect_ratio: c.proporcao_tela,
    created_at: c.criado_em,
    updated_at: c.atualizado_em,
  };
}

@Controller('api/clips')
@UseGuards(JwtAuthGuard)
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @Get()
  async findAll(@Query('videoId') videoId: any, @Request() req) {
    let vId = Array.isArray(videoId) ? videoId[0] : videoId;
    if (vId === 'null' || vId === 'undefined' || vId === '{videoId}') vId = undefined;
    if (vId && typeof vId === 'string' && vId.trim() === '') vId = undefined;
    const clips = await this.clipsService.findAll(req.user.id, vId);
    return clips.map(mapClip);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    const cid = id ? String(id).trim() : '';
    if (!cid || cid === 'null' || cid === 'undefined' || cid === '{id}' || cid === '{videoId}') {
      throw new BadRequestException('Invalid clip ID');
    }
    return mapClip(await this.clipsService.findOne(req.user.id, cid));
  }

  @Post('from-analysis/:videoId')
  async createFromAnalysis(@Param('videoId') videoId: string, @Request() req) {
    const clips = await this.clipsService.createAllFromAnalysis(
      req.user.id,
      videoId,
    );
    return clips.map(mapClip);
  }

  @Post('manual/:videoId')
  async createManual(
    @Param('videoId') videoId: string,
    @Body() body: any,
    @Request() req,
  ) {
    return mapClip(
      await this.clipsService.createManual(req.user.id, videoId, body),
    );
  }

  @Post(':id/export')
  async exportClip(
    @Param('id') id: string,
    @Body() options: any,
    @Request() req,
  ) {
    return mapClip(
      await this.clipsService.exportClip(req.user.id, id, options),
    );
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any, @Request() req) {
    return mapClip(await this.clipsService.update(req.user.id, id, body));
  }

  @Patch(':id/metadata')
  async updateMetadata(
    @Param('id') id: string,
    @Body() body: any,
    @Request() req,
  ) {
    return mapClip(
      await this.clipsService.updateMetadata(req.user.id, id, body),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.clipsService.remove(req.user.id, id);
  }
}
