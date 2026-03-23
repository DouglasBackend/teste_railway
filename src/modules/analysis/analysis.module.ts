import { Module } from "@nestjs/common";
import { AnalysisService } from "./analysis.service";
import { AudioAnalysisService } from "./audio-analysis.service";

@Module({
  providers: [AnalysisService, AudioAnalysisService],
  exports: [AnalysisService, AudioAnalysisService],
})
export class AnalysisModule {}
