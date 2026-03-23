import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';
import { RemotionRendererService } from './remotion-renderer.service';
import { GatewayModule } from '../gateway/gateway.module';
import { CLIP_EXPORT_QUEUE } from '../queue/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: CLIP_EXPORT_QUEUE }),
    GatewayModule
  ],
  controllers: [ClipsController],
  providers: [ClipsService, RemotionRendererService],
  exports: [ClipsService],
})
export class ClipsModule { }
