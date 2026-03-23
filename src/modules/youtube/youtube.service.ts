import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ContaYoutube } from '../../entities/conta_youtube.entity';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { TenantDbManager } from '../tenant/tenant-db.manager';

@Injectable()
export class YoutubeService {
    private readonly logger = new Logger(YoutubeService.name);
    private oauth2Client: OAuth2Client;

    constructor(
        private readonly configService: ConfigService,
        private readonly tenantDb: TenantDbManager,
    ) {
        const clientId = this.configService.get<string>('YOUTUBE_CLIENT_ID');
        const clientSecret = this.configService.get<string>('YOUTUBE_CLIENT_SECRET');
        const redirectUri = this.configService.get<string>('YOUTUBE_REDIRECT_URI') || 'http://localhost:3001/api/youtube/callback';
        this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    }

    private async getContasRepo(usuarioId: string): Promise<Repository<ContaYoutube>> {
        const ds = await this.tenantDb.getTenantDataSource(usuarioId);
        return ds.getRepository(ContaYoutube);
    }

    getAuthUrl(usuarioId: string): string {
        const scopes = [
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.readonly',
        ];

        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent',
            state: usuarioId, // Passar o ID no state para recuperar no callback
        });
    }

    async handleCallback(code: string, usuarioId: string): Promise<ContaYoutube> {
        try {
            const { tokens } = await this.oauth2Client.getToken(code);
            this.oauth2Client.setCredentials(tokens);

            const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });
            const channelResponse = await youtube.channels.list({
                part: ['snippet'],
                mine: true,
            });

            const channel = channelResponse.data.items?.[0];
            if (!channel) {
                throw new BadRequestException('Canal do YouTube não encontrado para essa conta.');
            }

            const channelId = channel.id as string;
            const channelName = channel.snippet?.title || 'Unknown Channel';
            const channelThumbnail = channel.snippet?.thumbnails?.default?.url || '';

            // Verifica se a conta já existe
            const repo = await this.getContasRepo(usuarioId);
            let account = await repo.findOne({ where: { id_canal: channelId, usuario_id: usuarioId } });

            if (account) {
                // Atualiza tokens
                account.access_token = tokens.access_token || account.access_token;
                if (tokens.refresh_token) {
                    account.refresh_token = tokens.refresh_token;
                }
                if (tokens.expiry_date) {
                    account.token_expiracao = tokens.expiry_date;
                }
                account.nome_canal = channelName;
                account.miniatura_canal = channelThumbnail;
            } else {
                // Cria conta
                account = repo.create({
                    id: uuidv4(),
                    usuario_id: usuarioId,
                    id_canal: channelId,
                    nome_canal: channelName,
                    miniatura_canal: channelThumbnail,
                    access_token: tokens.access_token as string,
                    refresh_token: tokens.refresh_token as string,
                    token_expiracao: tokens.expiry_date || 0,
                });
            }

            return await repo.save(account!);

        } catch (error) {
            this.logger.error('Error in YouTube OAuth callback', error);
            throw new BadRequestException('Falha ao autenticar com o YouTube');
        }
    }

    async getConnectedAccount(usuarioId: string): Promise<ContaYoutube | null> {
        const repo = await this.getContasRepo(usuarioId);
        const accounts = await repo.find({
            where: { usuario_id: usuarioId },
            order: { criado_em: 'DESC' },
            take: 1
        });
        return accounts[0] || null;
    }

    async disconnectAccount(usuarioId: string): Promise<void> {
        const account = await this.getConnectedAccount(usuarioId);
        if (account) {
            const repo = await this.getContasRepo(usuarioId);
            await repo.remove(account);
        }
    }

    async uploadVideo(
        usuarioId: string,
        filePath: string,
        title: string,
        description: string,
        privacyStatus: 'public' | 'private' | 'unlisted',
        tags?: string[]
    ): Promise<string> {
        const account = await this.getConnectedAccount(usuarioId);
        if (!account) {
            throw new NotFoundException('Nenhuma conta do YouTube conectada.');
        }

        this.oauth2Client.setCredentials({
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            expiry_date: account.token_expiracao ? Number(account.token_expiracao) : undefined,
        });

        this.oauth2Client.on('tokens', async (tokens) => {
            account.access_token = tokens.access_token as string;
            if (tokens.refresh_token) {
                account.refresh_token = tokens.refresh_token;
            }
            if (tokens.expiry_date) {
                account.token_expiracao = tokens.expiry_date;
            }
            const repo = await this.getContasRepo(usuarioId);
            await repo.save(account);
        });

        const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });

        let absolutePath = filePath;
        if (!path.isAbsolute(filePath)) {
            const uploadDir = this.configService.get<string>('UPLOAD_DIR', '/app/uploads');
            const cleanFilePath = filePath.replace(/^[\/\\]?uploads[\/\\]/, '');
            absolutePath = path.resolve(process.cwd(), uploadDir, cleanFilePath);

            if (!fs.existsSync(absolutePath)) {
                absolutePath = path.resolve(process.cwd(), 'uploads', cleanFilePath);
            }
        }

        if (!fs.existsSync(absolutePath)) {
            throw new NotFoundException(`Arquivo de vídeo não encontrado em: ${absolutePath}`);
        }

        const fileSize = fs.statSync(absolutePath).size;

        try {
            const res = await youtube.videos.insert({
                part: ['snippet', 'status'],
                requestBody: {
                    snippet: {
                        title,
                        description,
                        tags: tags || [],
                    },
                    status: {
                        privacyStatus,
                    },
                },
                media: {
                    body: fs.createReadStream(absolutePath),
                },
            }, {
                onUploadProgress: evt => {
                    const progress = (evt.bytesRead / fileSize) * 100;
                    this.logger.log(`Upload Progress: ${Math.round(progress)}%`);
                },
            });

            return res.data.id as string;
        } catch (error) {
            this.logger.error('Error uploading video to YouTube', error);
            throw new BadRequestException('Falha ao upar o vídeo no YouTube');
        }
    }
}
