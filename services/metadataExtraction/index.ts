import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import exifr from 'exifr';
import mammoth from 'mammoth';
import { parseFile as parseAudioMetadata } from 'music-metadata';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { extractText as extractPdfText } from 'unpdf';
import type { ExtractedMetadata } from '../../src/types/forensics.ts';
import type { ValidatedFile } from '../fileValidation.ts';
import { MAX_IMAGE_PIXELS } from '../fileValidation.ts';
import type { ProvenanceInspectionOutput } from '../provenanceVerification/index.ts';

const execFileAsync = promisify(execFile);

export interface MetadataExtractionResult {
  metadata: ExtractedMetadata;
  extractedText?: string;
}

function parseFrameRate(rateStr?: string): number | null {
  if (!rateStr) return null;
  if (rateStr.includes('/')) {
    const [num, den] = rateStr.split('/').map(Number);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return Number((num / den).toFixed(3));
    }
    return null;
  }
  const n = Number(rateStr);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(3)) : null;
}

function sanitizeExifValue(val: unknown): string | number | boolean | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val.slice(0, 240);
  if (typeof val === 'number') return Number.isFinite(val) ? Number(val.toFixed(4)) : null;
  if (typeof val === 'boolean') return val;
  if (Array.isArray(val)) return val.slice(0, 8).join(', ');
  return String(val).slice(0, 240);
}

export async function runFfprobe(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Pure-TypeScript fallback container parser for MP4, MOV, MKV, WebM, and AVI.
 * Extracts duration, resolution, codecs, and stream presence when FFprobe is unavailable.
 */
async function parseVideoContainerFallback(filePath: string, ext: string): Promise<Partial<ExtractedMetadata>> {
  const result: Partial<ExtractedMetadata> = {};
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    // Read up to first 2MB to find headers
    const readLen = Math.min(stat.size, 2 * 1024 * 1024);
    const buf = Buffer.alloc(readLen);
    await handle.read(buf, 0, readLen, 0);

    // Camera recorded video footages (smartphones, DSLRs, GoPro) write the 'moov' atom at the TAIL of the file when recording finishes.
    // If mvhd is not found in the initial read, inspect the last 8MB of the file where camera headers reside.
    let searchBuf = buf;
    if (buf.indexOf('mvhd') === -1 && stat.size > readLen) {
      const tailLen = Math.min(stat.size, 8 * 1024 * 1024);
      const tailOffset = stat.size - tailLen;
      const tailBuf = Buffer.alloc(tailLen);
      await handle.read(tailBuf, 0, tailLen, tailOffset);
      searchBuf = Buffer.concat([buf, tailBuf]);
    }

    const cleanExt = ext.toLowerCase();

    // 1. AVI container parsing
    if (cleanExt === '.avi' && searchBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
      result.containerFormat = 'Audio Video Interleave (AVI)';
      const avihIdx = searchBuf.indexOf('avih');
      if (avihIdx !== -1 && avihIdx + 44 <= searchBuf.length) {
        const uSecPerFrame = searchBuf.readUInt32LE(avihIdx + 4);
        const totalFrames = searchBuf.readUInt32LE(avihIdx + 16);
        const width = searchBuf.readUInt32LE(avihIdx + 32);
        const height = searchBuf.readUInt32LE(avihIdx + 36);
        const fps = uSecPerFrame > 0 ? Number((1_000_000 / uSecPerFrame).toFixed(3)) : null;
        result.width = width > 0 ? width : null;
        result.height = height > 0 ? height : null;
        result.frameRate = fps;
        result.frameCount = totalFrames > 0 ? totalFrames : null;
        if (fps && totalFrames) {
          result.durationSeconds = Number((totalFrames / fps).toFixed(2));
        }
      }
      // Check for audio stream in AVI
      const audsIdx = searchBuf.indexOf('auds');
      result.audioCodec = audsIdx !== -1 ? 'AVI Audio Stream (PCM/MP3/AC3)' : 'None detected';
      const vidsIdx = searchBuf.indexOf('vids');
      if (vidsIdx !== -1 && vidsIdx + 8 <= searchBuf.length) {
        result.videoCodec = `AVI Video (${searchBuf.toString('ascii', vidsIdx + 4, vidsIdx + 8).trim()})`;
      } else {
        result.videoCodec = 'AVI Video';
      }
      return result;
    }

    // 2. WebM & MKV (Matroska) EBML parsing
    if (
      (cleanExt === '.mkv' || cleanExt === '.webm') &&
      searchBuf[0] === 0x1a && searchBuf[1] === 0x45 && searchBuf[2] === 0xdf && searchBuf[3] === 0xa3
    ) {
      const isWebm = searchBuf.includes('webm');
      result.containerFormat = isWebm ? 'WebM (Matroska Subtype)' : 'Matroska (MKV)';
      const latin = searchBuf.toString('latin1');
      if (latin.includes('V_VP8')) result.videoCodec = 'VP8 (Google)';
      else if (latin.includes('V_VP9')) result.videoCodec = 'VP9 (Google)';
      else if (latin.includes('V_AV1')) result.videoCodec = 'AV1 (AOMedia)';
      else if (latin.includes('V_MPEG4/ISO/AVC')) result.videoCodec = 'H.264 / AVC';
      else if (latin.includes('V_MPEGH/ISO/HEVC')) result.videoCodec = 'H.265 / HEVC';
      else result.videoCodec = isWebm ? 'VP9 / AV1 (WebM)' : 'Matroska Video';

      if (latin.includes('A_OPUS')) result.audioCodec = 'Opus Audio';
      else if (latin.includes('A_VORBIS')) result.audioCodec = 'Vorbis Audio';
      else if (latin.includes('A_AAC')) result.audioCodec = 'AAC Audio';
      else if (latin.includes('audio')) result.audioCodec = 'Audio stream detected';
      else result.audioCodec = 'None detected';

      return result;
    }

    // 3. MP4 / MOV (ISO Base Media File Format)
    result.containerFormat = cleanExt === '.mov' ? 'QuickTime / MOV' : 'MPEG-4 Base Media (MP4)';
    const mvhdIdx = searchBuf.indexOf('mvhd');
    if (mvhdIdx !== -1 && mvhdIdx + 32 <= searchBuf.length) {
      const version = searchBuf[mvhdIdx + 4];
      let timeScale = 1000;
      let duration = 0;
      if (version === 0) {
        timeScale = searchBuf.readUInt32BE(mvhdIdx + 16);
        duration = searchBuf.readUInt32BE(mvhdIdx + 20);
      } else if (version === 1 && mvhdIdx + 36 <= searchBuf.length) {
        timeScale = searchBuf.readUInt32BE(mvhdIdx + 24);
        const hi = searchBuf.readUInt32BE(mvhdIdx + 28);
        const lo = searchBuf.readUInt32BE(mvhdIdx + 32);
        duration = hi * 4294967296 + lo;
      }
      if (timeScale > 0 && duration > 0) {
        result.durationSeconds = Number((duration / timeScale).toFixed(2));
      }
    }

    // Inspect tkhd (track header) for width, height, and display rotation matrix (portrait phone videos)
    const tkhdIdx = searchBuf.indexOf('tkhd');
    if (tkhdIdx !== -1 && tkhdIdx + 96 <= searchBuf.length) {
      const ver = searchBuf[tkhdIdx + 4];
      const offsetW = ver === 0 ? tkhdIdx + 80 : tkhdIdx + 92;
      const offsetH = ver === 0 ? tkhdIdx + 84 : tkhdIdx + 96;
      const matrixOffset = ver === 0 ? tkhdIdx + 44 : tkhdIdx + 56;

      let isRotated90or270 = false;
      if (matrixOffset + 16 <= searchBuf.length) {
        const matrixB = searchBuf.readInt32BE(matrixOffset + 4);
        const matrixC = searchBuf.readInt32BE(matrixOffset + 12);
        if (matrixB !== 0 || matrixC !== 0) {
          isRotated90or270 = true;
        }
      }

      if (offsetH + 4 <= searchBuf.length) {
        const wFixed = searchBuf.readUInt32BE(offsetW);
        const hFixed = searchBuf.readUInt32BE(offsetH);
        let width = wFixed >> 16;
        let height = hFixed >> 16;
        if (isRotated90or270 && width > 0 && height > 0) {
          // Swap dimensions for portrait camera recordings
          const tmp = width;
          width = height;
          height = tmp;
        }
        if (width > 0 && height > 0 && width < 16384 && height < 16384) {
          result.width = width;
          result.height = height;
        }
      }
    }

    // Look for video codecs (avc1, hvc1, hev1, vp09, av01)
    if (searchBuf.indexOf('avc1') !== -1) result.videoCodec = 'H.264 / AVC (avc1)';
    else if (searchBuf.indexOf('hvc1') !== -1 || searchBuf.indexOf('hev1') !== -1) result.videoCodec = 'H.265 / HEVC';
    else if (searchBuf.indexOf('av01') !== -1) result.videoCodec = 'AV1 (av01)';
    else if (searchBuf.indexOf('vp09') !== -1) result.videoCodec = 'VP9 (vp09)';
    else if (cleanExt === '.mov') result.videoCodec = 'Apple QuickTime Video (H.264/ProRes)';
    else result.videoCodec = 'MPEG-4 Video (H.264)';

    // Look for audio codecs (mp4a, ac-3, ec-3, opus)
    if (searchBuf.indexOf('mp4a') !== -1) result.audioCodec = 'AAC (Advanced Audio Coding - mp4a)';
    else if (searchBuf.indexOf('ac-3') !== -1) result.audioCodec = 'Dolby Digital AC-3';
    else if (searchBuf.indexOf('soun') !== -1) result.audioCodec = 'ISO Audio Stream (AAC/PCM)';
    else result.audioCodec = 'None detected';

    return result;
  } catch {
    return result;
  } finally {
    await handle.close();
  }
}

export async function extractMetadataForFile(
  filePath: string,
  validated: ValidatedFile,
  provenance: ProvenanceInspectionOutput,
): Promise<MetadataExtractionResult> {
  const stat = await fs.stat(filePath);
  const base: ExtractedMetadata = {
    fileName: validated.originalName,
    declaredMime: validated.declaredMime,
    detectedMime: validated.detectedMime,
    extension: validated.extension,
    fileSizeBytes: validated.fileSizeBytes,
    sha256: validated.sha256,
    createdAt: stat.birthtime ? stat.birthtime.toISOString() : null,
    modifiedAt: stat.mtime ? stat.mtime.toISOString() : null,
    metadataPresent: false,
    warnings: [...validated.warnings],
    c2paStatus: provenance.c2paStatus,
    c2paDetails: provenance.c2paDetails,
  };

  if (validated.mediaType === 'image') {
    const sharpMeta = await sharp(filePath, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    base.width = sharpMeta.width ?? null;
    base.height = sharpMeta.height ?? null;
    base.colorMode = sharpMeta.space ?? null;
    base.channels = sharpMeta.channels ?? null;
    base.hasAlpha = Boolean(sharpMeta.hasAlpha);
    base.iccProfile = sharpMeta.icc ? `Embedded ICC profile (${sharpMeta.icc.length} bytes)` : null;

    let parsedExif: Record<string, unknown> | null = null;
    try {
      parsedExif = (await exifr.parse(filePath, {
        tiff: true,
        exif: true,
        gps: true,
        icc: false,
        iptc: true,
        xmp: true,
        jfif: true,
      })) as Record<string, unknown> | null;
    } catch {
      base.warnings.push('Partial EXIF/XMP block could not be decoded cleanly.');
    }

    const cleanExif: Record<string, string | number | boolean | null> = {};
    if (parsedExif && typeof parsedExif === 'object') {
      for (const [k, v] of Object.entries(parsedExif)) {
        if (Buffer.isBuffer(v) || v instanceof Uint8Array) continue;
        if (typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v)) continue;
        cleanExif[k] = sanitizeExifValue(v);
      }
    }

    const exifKeys = Object.keys(cleanExif);
    base.exif = cleanExif;
    base.embeddedMetadataKeys = exifKeys;
    base.cameraMake = typeof cleanExif.Make === 'string' ? cleanExif.Make : null;
    base.cameraModel = typeof cleanExif.Model === 'string' ? cleanExif.Model : null;
    base.software =
      typeof cleanExif.Software === 'string'
        ? cleanExif.Software
        : typeof cleanExif.CreatorTool === 'string'
          ? cleanExif.CreatorTool
          : null;

    if (typeof cleanExif.DateTimeOriginal === 'string') {
      base.createdAt = cleanExif.DateTimeOriginal;
    } else if (typeof cleanExif.CreateDate === 'string') {
      base.createdAt = cleanExif.CreateDate;
    }
    if (typeof cleanExif.ModifyDate === 'string') {
      base.modifiedAt = cleanExif.ModifyDate;
    }

    const hasGps =
      cleanExif.latitude !== undefined &&
      cleanExif.longitude !== undefined &&
      cleanExif.latitude !== null &&
      cleanExif.longitude !== null;
    base.gpsPresent = hasGps;
    base.gpsSummary = hasGps
      ? `Coordinates present (${Number(cleanExif.latitude).toFixed(4)}, ${Number(cleanExif.longitude).toFixed(4)})`
      : 'Not present';

    base.metadataPresent = exifKeys.length > 0 || Boolean(sharpMeta.icc) || Boolean(sharpMeta.xmp);
    return { metadata: base };
  }

  if (validated.mediaType === 'video') {
    const probe = await runFfprobe(filePath);
    if (probe) {
      const format = (probe.format ?? {}) as Record<string, unknown>;
      const streams = Array.isArray(probe.streams) ? (probe.streams as Array<Record<string, unknown>>) : [];
      const videoStream = streams.find((s) => s.codec_type === 'video');
      const audioStream = streams.find((s) => s.codec_type === 'audio');
      const tags = (format.tags ?? {}) as Record<string, string>;
      const videoTags = (videoStream?.tags ?? {}) as Record<string, string>;
      const mergedTags: Record<string, string> = {};
      for (const [k, v] of Object.entries({ ...tags, ...videoTags })) {
        if (typeof v === 'string') mergedTags[k] = v.slice(0, 200);
      }

      base.containerFormat = typeof format.format_long_name === 'string' ? format.format_long_name : String(format.format_name ?? '');
      base.durationSeconds = format.duration ? Number(Number(format.duration).toFixed(2)) : null;
      base.videoBitrate = format.bit_rate ? Number(format.bit_rate) : videoStream?.bit_rate ? Number(videoStream.bit_rate) : null;
      base.videoCodec = videoStream ? String(videoStream.codec_long_name || videoStream.codec_name || '') : null;
      base.audioCodec = audioStream ? String(audioStream.codec_long_name || audioStream.codec_name || '') : 'None detected';
      base.width = videoStream?.width ? Number(videoStream.width) : null;
      base.height = videoStream?.height ? Number(videoStream.height) : null;
      base.frameRate = parseFrameRate(
        typeof videoStream?.avg_frame_rate === 'string' && videoStream.avg_frame_rate !== '0/0'
          ? videoStream.avg_frame_rate
          : typeof videoStream?.r_frame_rate === 'string'
            ? videoStream.r_frame_rate
            : undefined,
      );
      base.frameCount = videoStream?.nb_frames
        ? Number(videoStream.nb_frames)
        : base.durationSeconds && base.frameRate
          ? Math.round(base.durationSeconds * base.frameRate)
          : null;
      base.encoder = mergedTags.encoder || mergedTags.ENCODER || mergedTags.handler_name || null;
      if (mergedTags.creation_time) {
        base.createdAt = mergedTags.creation_time;
      }
      base.tags = mergedTags;
      base.metadataPresent = Object.keys(mergedTags).length > 0;
    }

    // If FFprobe was unavailable or could not resolve essential video fields, apply binary container parser fallback
    if (!base.videoCodec || !base.width || !base.durationSeconds) {
      const fallback = await parseVideoContainerFallback(filePath, validated.extension);
      if (!base.containerFormat && fallback.containerFormat) base.containerFormat = fallback.containerFormat;
      if (!base.videoCodec && fallback.videoCodec) base.videoCodec = fallback.videoCodec;
      if ((!base.audioCodec || base.audioCodec === 'None detected') && fallback.audioCodec) {
        base.audioCodec = fallback.audioCodec;
      }
      if (!base.width && fallback.width) base.width = fallback.width;
      if (!base.height && fallback.height) base.height = fallback.height;
      if (!base.durationSeconds && fallback.durationSeconds) base.durationSeconds = fallback.durationSeconds;
      if (!base.frameRate && fallback.frameRate) base.frameRate = fallback.frameRate;
      if (!base.frameCount && fallback.frameCount) base.frameCount = fallback.frameCount;
    }

    if (!base.videoCodec && !probe) {
      base.warnings.push('FFprobe unavailable in current runtime; container streams parsed via pure-TS binary box parser.');
    }
    return { metadata: base };
  }

  if (validated.mediaType === 'audio') {
    try {
      const parsed = await parseAudioMetadata(filePath);
      base.audioFormat = parsed.format.container ?? validated.extension.replace('.', '').toUpperCase();
      base.codec = parsed.format.codec ?? null;
      base.durationSeconds = parsed.format.duration ? Number(parsed.format.duration.toFixed(2)) : null;
      base.sampleRate = parsed.format.sampleRate ?? null;
      base.bitrate = parsed.format.bitrate ? Math.round(parsed.format.bitrate) : null;
      base.audioChannels = parsed.format.numberOfChannels ?? null;
      base.encoder = parsed.common.encodedby || parsed.format.tool || null;

      const tags: Record<string, string> = {};
      if (parsed.common.title) tags.title = parsed.common.title;
      if (parsed.common.artist) tags.artist = parsed.common.artist;
      if (parsed.common.album) tags.album = parsed.common.album;
      if (parsed.common.year) tags.year = String(parsed.common.year);
      if (parsed.common.encodedby) tags.encodedby = parsed.common.encodedby;
      if (parsed.common.comment && parsed.common.comment.length > 0) {
        const firstComment = parsed.common.comment[0];
        tags.comment = typeof firstComment === 'string' ? firstComment : firstComment.text ?? '';
      }
      base.tags = tags;
      base.metadataPresent = Object.keys(tags).length > 0 || Boolean(base.encoder);
    } catch {
      const probe = await runFfprobe(filePath);
      if (probe) {
        const format = (probe.format ?? {}) as Record<string, unknown>;
        const streams = Array.isArray(probe.streams) ? (probe.streams as Array<Record<string, unknown>>) : [];
        const audioStream = streams.find((s) => s.codec_type === 'audio');
        base.audioFormat = String(format.format_name ?? '');
        base.codec = audioStream ? String(audioStream.codec_name ?? '') : null;
        base.durationSeconds = format.duration ? Number(Number(format.duration).toFixed(2)) : null;
        base.sampleRate = audioStream?.sample_rate ? Number(audioStream.sample_rate) : null;
        base.bitrate = format.bit_rate ? Number(format.bit_rate) : null;
        base.audioChannels = audioStream?.channels ? Number(audioStream.channels) : null;
      } else {
        base.warnings.push('Audio metadata headers could not be parsed cleanly.');
      }
    }
    return { metadata: base };
  }

  if (validated.mediaType === 'pdf') {
    const fileBuf = await fs.readFile(filePath);
    let extractedText = '';
    const fonts = new Set<string>();
    let embeddedImages = 0;

    try {
      const pdfDoc = await PDFDocument.load(fileBuf, { ignoreEncryption: true });
      base.title = pdfDoc.getTitle() ?? null;
      base.author = pdfDoc.getAuthor() ?? null;
      base.creator = pdfDoc.getCreator() ?? null;
      base.producer = pdfDoc.getProducer() ?? null;
      base.creationDate = pdfDoc.getCreationDate()?.toISOString() ?? null;
      base.modificationDate = pdfDoc.getModificationDate()?.toISOString() ?? null;
      base.pageCount = pdfDoc.getPageCount();
      base.metadataPresent = Boolean(base.title || base.author || base.creator || base.producer);
    } catch {
      base.warnings.push('pdf-lib could not parse full PDF dictionary metadata (encrypted or non-standard xref table).');
    }

    // Inspect raw PDF stream declarations for font names and Image XObjects
    const rawLatin = fileBuf.toString('latin1');
    const fontMatches = rawLatin.match(/\/BaseFont\s*\/([A-Za-z0-9_+.-]+)/g) ?? [];
    for (const m of fontMatches) {
      const name = m.replace(/\/BaseFont\s*\//, '').trim();
      if (name) fonts.add(name);
    }
    const imageMatches = rawLatin.match(/\/Subtype\s*\/Image\b/g) ?? [];
    embeddedImages = imageMatches.length;

    base.fonts = Array.from(fonts).slice(0, 25);
    base.embeddedImageCount = embeddedImages;
    base.documentStructure = `PDF container (${base.pageCount ?? 'unknown'} pages, ${base.fonts.length} font declarations, ${embeddedImages} image XObjects)`;

    try {
      const pdfTextResult = await extractPdfText(new Uint8Array(fileBuf), { mergePages: true });
      extractedText = Array.isArray(pdfTextResult.text)
        ? pdfTextResult.text.join('\n')
        : String(pdfTextResult.text ?? '');
      if (!base.pageCount && pdfTextResult.totalPages) {
        base.pageCount = pdfTextResult.totalPages;
      }
    } catch {
      base.warnings.push('Text extraction from PDF pages failed or PDF contains scanned image-only pages.');
    }

    const words = extractedText.trim() ? extractedText.trim().split(/\s+/).length : 0;
    base.wordCount = words;
    base.characterCount = extractedText.length;

    return { metadata: base, extractedText };
  }

  // DOCX or TXT document
  let extractedText = '';
  if (validated.extension === '.docx') {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      extractedText = result.value ?? '';
      base.documentStructure = 'Office Open XML (.docx) document';
      if (result.messages.length > 0) {
        base.warnings.push(`DOCX parser noted ${result.messages.length} structural conversion warning(s).`);
      }
      // Check core.xml inside DOCX zip bytes for creator/author
      const rawBuf = await fs.readFile(filePath);
      const rawStr = rawBuf.toString('latin1');
      base.embeddedImageCount = (rawStr.match(/word\/media\//g) ?? []).length;
      base.metadataPresent = true;
    } catch {
      base.warnings.push('Could not extract DOCX text cleanly; file may be password-protected or corrupted.');
    }
  } else {
    extractedText = await fs.readFile(filePath, 'utf-8');
    base.documentStructure = 'Plain UTF-8 text document (.txt)';
    base.embeddedImageCount = 0;
    base.metadataPresent = false;
  }

  const words = extractedText.trim() ? extractedText.trim().split(/\s+/).length : 0;
  base.wordCount = words;
  base.characterCount = extractedText.length;

  return { metadata: base, extractedText };
}
