import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { TranscriptionModule } from '../transcription/transcription.module';
import { VIDEO_QUEUE } from '../queue/queue.constants';



@Module({
  imports: [
    
    BullModule.registerQueue({ name: VIDEO_QUEUE }),
    TranscriptionModule,
  ],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule { }
