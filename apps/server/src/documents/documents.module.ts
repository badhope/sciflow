import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ReferencesModule } from '../references/references.module';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { PdfExportService } from './pdf-export.service';

@Module({
  imports: [AiModule, ReferencesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, PdfExportService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
