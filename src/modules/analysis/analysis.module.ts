import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AnalysisService } from "./analysis.service";
import { AudioAnalysisService } from "./audio-analysis.service";

@Module({
  imports: [ConfigModule],
  providers: [AnalysisService, AudioAnalysisService],
  exports: [AnalysisService, AudioAnalysisService],
})
export class AnalysisModule {}
