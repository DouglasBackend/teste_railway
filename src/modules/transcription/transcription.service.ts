import { Injectable, Logger } from "@nestjs/common";
import { AssemblyAI } from "assemblyai";

@Injectable()
export class TranscriptionService {
  private client: AssemblyAI;
  private readonly logger = new Logger(TranscriptionService.name);

  constructor() {
    this.client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY || "" });
  }

  async transcribe(filePath: string): Promise<{
    id: string;
    text: string;
    words: any[];
    sentences: any[];
  }> {
    const langCode = process.env.TRANSCRIPTION_LANGUAGE || null;

    try {
      const transcriptParams: any = {
        audio: filePath,
        speech_models: ["universal-2"],
        punctuate: true,
        format_text: true,
        // Word-level timestamps — critical for accurate clip cutting and ASS subtitles
        word_boost: [],
      };

      // If explicit language set, force it; otherwise use auto-detection
      if (langCode) {
        transcriptParams.language_code = langCode;
      } else {
        transcriptParams.language_detection = true;
      }

      this.logger.log(
        `Transcribing with model=best, lang=${langCode || "auto-detect"}`,
      );
      const transcript =
        await this.client.transcripts.transcribe(transcriptParams);

      if (transcript.status === "error") {
        throw new Error(`AssemblyAI transcription failed: ${transcript.error}`);
      }

      this.logger.log(
        `Transcription complete: ${transcript.words?.length ?? 0} words, lang=${transcript.language_code}`,
      );

      return {
        id: transcript.id,
        text: transcript.text || "",
        words: transcript.words || [],
        sentences: [],
      };
    } catch (error) {
      this.logger.error(`Transcription error: ${error.message}`);
      throw error;
    }
  }

  async getSubtitlesSRT(
    transcriptId: string,
    charsPerCaption = 40,
  ): Promise<string> {
    return this.client.transcripts.subtitles(
      transcriptId,
      "srt",
      charsPerCaption,
    );
  }

  async getSubtitlesVTT(
    transcriptId: string,
    charsPerCaption = 40,
  ): Promise<string> {
    return this.client.transcripts.subtitles(
      transcriptId,
      "vtt",
      charsPerCaption,
    );
  }

  async getStatus(transcriptId: string): Promise<any> {
    return this.client.transcripts.get(transcriptId);
  }
}
