#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <math.h>

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#include "cJSON.h"

#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/samplefmt.h>
#include <libavutil/mathematics.h>
#include <libavutil/channel_layout.h>
#include <libavutil/opt.h>
#include <libswresample/swresample.h>

#define HELPER_VERSION "1.8.2"

/*
 * Ring buffer capacity expressed strictly in AUDIO FRAMES throughout.
 * 1 frame = (channels) audio samples across all channels at a single point in time.
 * For stereo (channels = 2), 1 frame = 2 float samples = 8 bytes.
 * Capacity = 65,536 frames:
 *   - Stereo (2 ch):  65,536 frames = 131,072 float samples = 524,288 bytes (512 KiB).
 *   - 5.1 (6 ch):     65,536 frames = 393,216 float samples = 1,572,864 bytes (1.5 MiB).
 *   - 7.1 (8 ch):     65,536 frames = 524,288 float samples = 2,097,152 bytes (2.0 MiB).
 */
#define RING_BUFFER_CAPACITY_FRAMES 65536
#define SPECTRUM_BINS 32
#define ANALYSIS_WINDOW_SIZE 512

/* --- Thread Synchronization & Logging --- */
static CRITICAL_SECTION g_cs_stdout;
static CRITICAL_SECTION g_cs_engine;
static CRITICAL_SECTION g_cs_ring;

static void print_json_line(cJSON* root) {
    char* str = cJSON_PrintUnformatted(root);
    if (!str) return;
    EnterCriticalSection(&g_cs_stdout);
    fputs(str, stdout);
    fputc('\n', stdout);
    fflush(stdout);
    LeaveCriticalSection(&g_cs_stdout);
    free(str);
}

static void send_response(const cJSON* id_item, bool success, cJSON* data, const char* error) {
    cJSON* res = cJSON_CreateObject();
    if (id_item) {
        if (cJSON_IsNumber(id_item)) {
            cJSON_AddNumberToObject(res, "id", id_item->valuedouble);
        } else if (cJSON_IsString(id_item)) {
            cJSON_AddStringToObject(res, "id", id_item->valuestring);
        }
    }
    cJSON_AddBoolToObject(res, "success", success);
    if (data) {
        cJSON_AddItemToObject(res, "data", data);
    }
    if (error) {
        cJSON_AddStringToObject(res, "error", error);
    }
    print_json_line(res);
    cJSON_Delete(res);
}

static void send_event(const char* event_name, cJSON* payload) {
    cJSON* evt = cJSON_CreateObject();
    cJSON_AddStringToObject(evt, "event", event_name);
    if (payload) {
        cJSON* child = payload->child;
        while (child) {
            cJSON* next = child->next;
            cJSON_DetachItemViaPointer(payload, child);
            cJSON_AddItemToObject(evt, child->string, child);
            child = next;
        }
        cJSON_Delete(payload);
    }
    print_json_line(evt);
    cJSON_Delete(evt);
}

/* --- Ring Buffer for Interleaved Float32 Audio (Strictly Frame-Indexed) --- */
typedef struct {
    float* data;
    size_t capacity_frames;  /* Expressed strictly in audio frames */
    size_t channels;         /* Channels per frame (e.g. 2 for stereo) */
    size_t read_idx;         /* Read position in frames */
    size_t write_idx;        /* Write position in frames */
    size_t available_frames; /* Count of unread frames */
} RingBuffer;

static RingBuffer g_ring;

static void ring_init(RingBuffer* rb, size_t capacity_frames, size_t channels) {
    rb->capacity_frames = capacity_frames;
    rb->channels = (channels > 0) ? channels : 2;
    rb->data = (float*)calloc(capacity_frames * rb->channels, sizeof(float));
    rb->read_idx = 0;
    rb->write_idx = 0;
    rb->available_frames = 0;
}

static void ring_clear(RingBuffer* rb) {
    EnterCriticalSection(&g_cs_ring);
    rb->read_idx = 0;
    rb->write_idx = 0;
    rb->available_frames = 0;
    LeaveCriticalSection(&g_cs_ring);
}

static size_t ring_write(RingBuffer* rb, const float* src, size_t frames) {
    EnterCriticalSection(&g_cs_ring);
    size_t space = rb->capacity_frames - rb->available_frames;
    size_t to_write = (frames < space) ? frames : space;
    if (to_write == 0) {
        LeaveCriticalSection(&g_cs_ring);
        return 0;
    }

    size_t ch = rb->channels;
    size_t first_part = rb->capacity_frames - rb->write_idx;
    if (to_write <= first_part) {
        memcpy(rb->data + (rb->write_idx * ch), src, to_write * ch * sizeof(float));
        rb->write_idx = (rb->write_idx + to_write) % rb->capacity_frames;
    } else {
        memcpy(rb->data + (rb->write_idx * ch), src, first_part * ch * sizeof(float));
        size_t second_part = to_write - first_part;
        memcpy(rb->data, src + (first_part * ch), second_part * ch * sizeof(float));
        rb->write_idx = second_part;
    }
    rb->available_frames += to_write;
    LeaveCriticalSection(&g_cs_ring);
    return to_write;
}

static size_t ring_read(RingBuffer* rb, float* dst, size_t frames) {
    EnterCriticalSection(&g_cs_ring);
    size_t avail = rb->available_frames;
    size_t to_read = (frames < avail) ? frames : avail;
    if (to_read == 0) {
        LeaveCriticalSection(&g_cs_ring);
        return 0;
    }

    size_t ch = rb->channels;
    size_t first_part = rb->capacity_frames - rb->read_idx;
    if (to_read <= first_part) {
        memcpy(dst, rb->data + (rb->read_idx * ch), to_read * ch * sizeof(float));
        rb->read_idx = (rb->read_idx + to_read) % rb->capacity_frames;
    } else {
        memcpy(dst, rb->data + (rb->read_idx * ch), first_part * ch * sizeof(float));
        size_t second_part = to_read - first_part;
        memcpy(dst + (first_part * ch), rb->data, second_part * ch * sizeof(float));
        rb->read_idx = second_part;
    }
    rb->available_frames -= to_read;
    LeaveCriticalSection(&g_cs_ring);
    return to_read;
}

static size_t ring_available(RingBuffer* rb) {
    EnterCriticalSection(&g_cs_ring);
    size_t a = rb->available_frames;
    LeaveCriticalSection(&g_cs_ring);
    return a;
}

/* --- Playback State & Contexts --- */
typedef enum {
    STATE_STOPPED = 0,
    STATE_PLAYING = 1,
    STATE_PAUSED = 2
} PlaybackState;

typedef struct {
    char file_path[4096];
    AVFormatContext* fmt_ctx;
    AVCodecContext* codec_ctx;
    SwrContext* swr_ctx;
    int audio_stream_idx;
    char codec_name[64];
    char format_name[64];
    int64_t bit_rate;
    int sample_rate;
    int channels;
    enum AVSampleFormat sample_fmt;
    int bit_depth;
    double duration_seconds;
    int64_t initial_padding;
    int64_t initial_padding_discarded;
    int64_t trailing_padding;
    int64_t total_expected_samples;
    int64_t total_samples_decoded;
    bool skip_samples_applied_by_codec;
    bool eof_reached;
    bool is_valid;
} TrackContext;

typedef struct {
    char requested_mode[32];       /* "shared" or "exclusive" */
    char requested_format[32];     /* "float32" */
    int requested_sample_rate;
    int requested_channels;

    char accepted_mode[32];        /* "shared" or "exclusive" */
    char accepted_format[32];      /* "float32" */
    int accepted_sample_rate;
    int accepted_channels;
    char channel_layout[64];       /* "Stereo (L, R)" */

    int miniaudio_result;          /* ma_result code */
    const char* miniaudio_result_name; /* e.g. "MA_SUCCESS" */
    long windows_hresult;          /* Windows HRESULT */
    char windows_hresult_hex[64];  /* e.g. "0x00000000 (S_OK)" or "0x8889000A (AUDCLNT_E_DEVICE_IN_USE)" */

    bool fallback_occurred;
    char fallback_reason[256];
} WasapiTelemetry;

typedef struct {
    ma_context ma_ctx;
    ma_device ma_dev;
    bool ma_ctx_initialized;
    bool ma_dev_initialized;

    int output_mode; /* 0 = Shared, 1 = Exclusive */
    int buffer_mode; /* 0 = Default, 1 = Low Latency */
    char selected_device_id[256];
    char selected_device_name[256];
    bool use_default_device;

    int actual_output_sample_rate;
    int actual_output_channels;
    ma_format actual_output_format;
    bool exclusive_fallback;
    char exclusive_fallback_reason[256];

    PlaybackState state;
    float volume; /* Normalized strictly: 0.0 to 1.0. 1.0 == 100% unity gain */
    bool muted;
    int64_t played_frames;
    double current_position;

    TrackContext current_track;
    TrackContext next_track;
    bool has_next_track;

    /* Seamless Gapless Transition Tracking */
    bool transition_pending;
    size_t track_transition_remaining_frames;

    /* Seeking */
    bool seek_requested;
    double seek_target_seconds;

    /* Analysis & Metering */
    float analysis_window[ANALYSIS_WINDOW_SIZE * 2];
    size_t analysis_window_count;
    float meter_peak_l;
    float meter_peak_r;
    float meter_rms_l;
    float meter_rms_r;
    float meter_bins[SPECTRUM_BINS];
    bool meter_clipping;

    /* Telemetry & Quality Monitoring */
    WasapiTelemetry telemetry;
    int64_t audio_underruns;
    int64_t genuine_underruns;
    int64_t deliberate_buffer_flushes;
    int64_t audio_dropouts;
    bool buffer_primed;

    /* Threads */
    HANDLE h_decode_thread;
    HANDLE h_meter_thread;
    HANDLE h_shutdown_event;
    bool running;
} PureAudioEngine;

static PureAudioEngine g_engine;

/* --- Utility Name Formatting --- */
static const char* get_ma_result_name(ma_result res) {
    switch (res) {
        case MA_SUCCESS: return "MA_SUCCESS";
        case MA_ERROR: return "MA_ERROR";
        case MA_INVALID_ARGS: return "MA_INVALID_ARGS";
        case MA_INVALID_OPERATION: return "MA_INVALID_OPERATION";
        case MA_OUT_OF_MEMORY: return "MA_OUT_OF_MEMORY";
        case MA_FORMAT_NOT_SUPPORTED: return "MA_FORMAT_NOT_SUPPORTED";
        case MA_DEVICE_TYPE_NOT_SUPPORTED: return "MA_DEVICE_TYPE_NOT_SUPPORTED";
        case MA_SHARE_MODE_NOT_SUPPORTED: return "MA_SHARE_MODE_NOT_SUPPORTED";
        case MA_NO_BACKEND: return "MA_NO_BACKEND";
        case MA_NO_DEVICE: return "MA_NO_DEVICE";
        case MA_DEVICE_NOT_INITIALIZED: return "MA_DEVICE_NOT_INITIALIZED";
        case MA_FAILED_TO_INIT_BACKEND: return "MA_FAILED_TO_INIT_BACKEND";
        case MA_FAILED_TO_OPEN_BACKEND_DEVICE: return "MA_FAILED_TO_OPEN_BACKEND_DEVICE";
        case MA_FAILED_TO_START_BACKEND_DEVICE: return "MA_FAILED_TO_START_BACKEND_DEVICE";
        default: return "MA_UNKNOWN_ERROR";
    }
}

static void format_hresult_string(long hr, char* buf, size_t buf_sz) {
    if (hr == 0) {
        snprintf(buf, buf_sz, "0x00000000 (S_OK)");
    } else if (hr == (long)0x8889000E) {
        snprintf(buf, buf_sz, "0x8889000E (AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED)");
    } else if (hr == (long)0x8889000A) {
        snprintf(buf, buf_sz, "0x8889000A (AUDCLNT_E_DEVICE_IN_USE)");
    } else if (hr == (long)0x88890008) {
        snprintf(buf, buf_sz, "0x88890008 (AUDCLNT_E_UNSUPPORTED_FORMAT)");
    } else if (hr == (long)0x88890004) {
        snprintf(buf, buf_sz, "0x88890004 (AUDCLNT_E_DEVICE_INVALIDATED)");
    } else if (hr == (long)0x80070057) {
        snprintf(buf, buf_sz, "0x80070057 (E_INVALIDARG)");
    } else {
        snprintf(buf, buf_sz, "0x%08lX (COM_ERROR)", hr);
    }
}

static void get_channel_layout_string(size_t channels, char* buf, size_t buf_sz) {
    if (channels == 1) {
        snprintf(buf, buf_sz, "Mono (C)");
    } else if (channels == 2) {
        snprintf(buf, buf_sz, "Stereo (L, R)");
    } else if (channels == 6) {
        snprintf(buf, buf_sz, "5.1 Surround (L, R, C, LFE, Ls, Rs)");
    } else if (channels == 8) {
        snprintf(buf, buf_sz, "7.1 Surround (L, R, C, LFE, Ls, Rs, Rls, Rrs)");
    } else {
        snprintf(buf, buf_sz, "%zu Channels", channels);
    }
}

/* --- Track Lifecycle Helper --- */
static void track_context_free(TrackContext* tc) {
    if (!tc) return;
    if (tc->swr_ctx) {
        swr_free(&tc->swr_ctx);
        tc->swr_ctx = NULL;
    }
    if (tc->codec_ctx) {
        avcodec_free_context(&tc->codec_ctx);
        tc->codec_ctx = NULL;
    }
    if (tc->fmt_ctx) {
        avformat_close_input(&tc->fmt_ctx);
        tc->fmt_ctx = NULL;
    }
    tc->is_valid = false;
    tc->file_path[0] = '\0';
}

static bool track_context_open(TrackContext* tc, const char* file_path, int target_sample_rate, int target_channels) {
    track_context_free(tc);
    memset(tc, 0, sizeof(TrackContext));
    strncpy(tc->file_path, file_path, sizeof(tc->file_path) - 1);

    if (avformat_open_input(&tc->fmt_ctx, file_path, NULL, NULL) < 0) {
        return false;
    }
    if (avformat_find_stream_info(tc->fmt_ctx, NULL) < 0) {
        track_context_free(tc);
        return false;
    }

    const AVCodec* decoder = NULL;
    tc->audio_stream_idx = av_find_best_stream(tc->fmt_ctx, AVMEDIA_TYPE_AUDIO, -1, -1, &decoder, 0);
    if (tc->audio_stream_idx < 0 || !decoder) {
        track_context_free(tc);
        return false;
    }

    AVStream* stream = tc->fmt_ctx->streams[tc->audio_stream_idx];
    tc->codec_ctx = avcodec_alloc_context3(decoder);
    if (!tc->codec_ctx) {
        track_context_free(tc);
        return false;
    }

    if (avcodec_parameters_to_context(tc->codec_ctx, stream->codecpar) < 0) {
        track_context_free(tc);
        return false;
    }

    if (avcodec_open2(tc->codec_ctx, decoder, NULL) < 0) {
        track_context_free(tc);
        return false;
    }

    strncpy(tc->codec_name, decoder->name, sizeof(tc->codec_name) - 1);
    if (tc->fmt_ctx->iformat && tc->fmt_ctx->iformat->name) {
        strncpy(tc->format_name, tc->fmt_ctx->iformat->name, sizeof(tc->format_name) - 1);
    } else {
        strncpy(tc->format_name, "Audio", sizeof(tc->format_name) - 1);
    }

    tc->sample_rate = tc->codec_ctx->sample_rate;
    tc->channels = tc->codec_ctx->ch_layout.nb_channels;
    tc->sample_fmt = tc->codec_ctx->sample_fmt;
    tc->bit_rate = tc->codec_ctx->bit_rate ? tc->codec_ctx->bit_rate : stream->codecpar->bit_rate;
    tc->bit_depth = av_get_bytes_per_sample(tc->sample_fmt) * 8;

    if (stream->duration != AV_NOPTS_VALUE) {
        tc->duration_seconds = (double)stream->duration * av_q2d(stream->time_base);
    } else if (tc->fmt_ctx->duration != AV_NOPTS_VALUE) {
        tc->duration_seconds = (double)tc->fmt_ctx->duration / AV_TIME_BASE;
    } else {
        tc->duration_seconds = 0.0;
    }

    /* Gapless padding extraction and exact stream duration calculation */
    tc->initial_padding = tc->codec_ctx->initial_padding;
    tc->trailing_padding = tc->codec_ctx->trailing_padding;
    if (tc->initial_padding == 0 && stream->codecpar->initial_padding > 0) {
        tc->initial_padding = stream->codecpar->initial_padding;
    }
    if (tc->trailing_padding == 0 && stream->codecpar->trailing_padding > 0) {
        tc->trailing_padding = stream->codecpar->trailing_padding;
    }

    /* Check iTunes iTunSMPB metadata tag in container or stream */
    AVDictionaryEntry* smpb_entry = av_dict_get(tc->fmt_ctx->metadata, "iTunSMPB", NULL, 0);
    if (!smpb_entry) smpb_entry = av_dict_get(stream->metadata, "iTunSMPB", NULL, 0);
    if (smpb_entry && smpb_entry->value) {
        uint32_t dummy = 0, delay = 0, padding = 0;
        uint64_t valid_samples = 0;
        if (sscanf(smpb_entry->value, " %x %x %x %llx", &dummy, &delay, &padding, &valid_samples) >= 4) {
            if (delay > 0 && tc->initial_padding == 0) tc->initial_padding = delay;
            if (padding > 0 && tc->trailing_padding == 0) tc->trailing_padding = padding;
            if (valid_samples > 0) tc->total_expected_samples = (int64_t)valid_samples;
        }
    }

    /* Standard AAC-LC priming delay fallback (1024 samples) for MP4/M4A containers if not provided by atom */
    if (tc->codec_ctx->codec_id == AV_CODEC_ID_AAC && tc->initial_padding == 0 &&
        (strstr(tc->format_name, "mp4") != NULL || strstr(tc->format_name, "mov") != NULL || strstr(tc->format_name, "m4a") != NULL)) {
        tc->initial_padding = 1024;
    }

    if (tc->total_expected_samples <= 0) {
        if (stream->duration != AV_NOPTS_VALUE && stream->duration > 0) {
            tc->total_expected_samples = av_rescale_q(stream->duration, stream->time_base, (AVRational){1, tc->sample_rate});
        } else if (tc->fmt_ctx->duration != AV_NOPTS_VALUE && tc->fmt_ctx->duration > 0) {
            tc->total_expected_samples = (int64_t)(tc->duration_seconds * tc->sample_rate);
        } else {
            tc->total_expected_samples = -1;
        }
    }
    tc->initial_padding_discarded = 0;
    tc->total_samples_decoded = 0;
    tc->skip_samples_applied_by_codec = false;

    /* Resampler setup if needed */
    bool needs_resample = false;
    if (tc->sample_rate != target_sample_rate || tc->channels != target_channels || tc->sample_fmt != AV_SAMPLE_FMT_FLT) {
        needs_resample = true;
    }

    if (needs_resample) {
        AVChannelLayout out_layout;
        av_channel_layout_default(&out_layout, target_channels);

        int swr_err = swr_alloc_set_opts2(
            &tc->swr_ctx,
            &out_layout,
            AV_SAMPLE_FMT_FLT,
            target_sample_rate,
            &tc->codec_ctx->ch_layout,
            tc->sample_fmt,
            tc->sample_rate,
            0,
            NULL
        );
        av_channel_layout_uninit(&out_layout);

        if (swr_err < 0 || swr_init(tc->swr_ctx) < 0) {
            track_context_free(tc);
            return false;
        }
    } else {
        tc->swr_ctx = NULL;
    }

    tc->is_valid = true;
    return true;
}

/* --- Build Audio Path JSON Object (With Complete WASAPI Negotiation Telemetry) --- */
static cJSON* build_audio_path_json(void) {
    cJSON* p = cJSON_CreateObject();
    EnterCriticalSection(&g_cs_engine);

    TrackContext* cur = &g_engine.current_track;
    if (cur->is_valid) {
        cJSON_AddStringToObject(p, "decoder", cur->codec_name);
        cJSON_AddStringToObject(p, "sourceFormat", cur->format_name);
        cJSON_AddNumberToObject(p, "sourceSampleRate", cur->sample_rate);
        cJSON_AddNumberToObject(p, "sourceChannels", cur->channels);
        cJSON_AddNumberToObject(p, "sourceBitRate", (double)cur->bit_rate);
        cJSON_AddNumberToObject(p, "sourceBitDepth", cur->bit_depth);
    } else {
        cJSON_AddStringToObject(p, "decoder", "None");
        cJSON_AddStringToObject(p, "sourceFormat", "None");
        cJSON_AddNumberToObject(p, "sourceSampleRate", 0);
        cJSON_AddNumberToObject(p, "sourceChannels", 0);
        cJSON_AddNumberToObject(p, "sourceBitRate", 0);
        cJSON_AddNumberToObject(p, "sourceBitDepth", 0);
    }

    cJSON_AddBoolToObject(p, "dspEnabled", false);
    cJSON_AddBoolToObject(p, "replayGainEnabled", false);

    bool vol_scaled = (g_engine.volume < 0.999f) || g_engine.muted;
    cJSON_AddBoolToObject(p, "softwareVolumeActive", vol_scaled);
    cJSON_AddNumberToObject(p, "gain", g_engine.muted ? 0.0 : (double)g_engine.volume);

    bool resampled = cur->is_valid && (cur->sample_rate != g_engine.actual_output_sample_rate || cur->channels != 2);
    cJSON_AddBoolToObject(p, "resamplingActive", resampled);
    if (resampled) {
        char buf[64];
        snprintf(buf, sizeof(buf), "%d Hz -> %d Hz", cur->sample_rate, g_engine.actual_output_sample_rate);
        cJSON_AddStringToObject(p, "resamplingRatio", buf);
    } else {
        cJSON_AddStringToObject(p, "resamplingRatio", "None (1:1 Bit Transparent)");
    }

    cJSON_AddNumberToObject(p, "outputSampleRate", g_engine.actual_output_sample_rate);
    cJSON_AddNumberToObject(p, "outputChannels", g_engine.actual_output_channels);
    cJSON_AddStringToObject(p, "outputFormat", "float32");

    const char* mode_str = (g_engine.output_mode == 1) ? "WASAPI Exclusive" : "WASAPI Shared";
    cJSON_AddStringToObject(p, "outputMode", mode_str);
    cJSON_AddStringToObject(p, "selectedDevice", g_engine.selected_device_name[0] ? g_engine.selected_device_name : "Default Windows Audio Endpoint");

    /* WASAPI Negotiation Telemetry (Requirement 4) */
    cJSON_AddStringToObject(p, "requestedMode", g_engine.telemetry.requested_mode);
    cJSON_AddStringToObject(p, "requestedFormat", g_engine.telemetry.requested_format);
    cJSON_AddStringToObject(p, "requestedSampleFormat", g_engine.telemetry.requested_format);
    cJSON_AddNumberToObject(p, "requestedSampleRate", g_engine.telemetry.requested_sample_rate);
    cJSON_AddNumberToObject(p, "requestedChannels", g_engine.telemetry.requested_channels);

    cJSON_AddStringToObject(p, "acceptedMode", g_engine.telemetry.accepted_mode);
    cJSON_AddStringToObject(p, "acceptedFormat", g_engine.telemetry.accepted_format);
    cJSON_AddStringToObject(p, "acceptedSampleFormat", g_engine.telemetry.accepted_format);
    cJSON_AddNumberToObject(p, "acceptedSampleRate", g_engine.telemetry.accepted_sample_rate);
    cJSON_AddNumberToObject(p, "acceptedChannels", g_engine.telemetry.accepted_channels);
    cJSON_AddStringToObject(p, "channelLayout", g_engine.telemetry.channel_layout);

    cJSON_AddNumberToObject(p, "miniaudioResult", g_engine.telemetry.miniaudio_result);
    cJSON_AddStringToObject(p, "miniaudioResultName", g_engine.telemetry.miniaudio_result_name ? g_engine.telemetry.miniaudio_result_name : "UNKNOWN");
    cJSON_AddNumberToObject(p, "windowsHresult", g_engine.telemetry.windows_hresult);
    cJSON_AddStringToObject(p, "windowsHresultHex", g_engine.telemetry.windows_hresult_hex);

    cJSON_AddBoolToObject(p, "fallbackOccurred", g_engine.telemetry.fallback_occurred);
    cJSON_AddStringToObject(p, "fallbackReason", g_engine.telemetry.fallback_reason);

    /* Quality Metrics: Underruns, Dropouts, Ring Buffer Capacity in Frames */
    cJSON_AddNumberToObject(p, "audioUnderruns", (double)g_engine.audio_underruns);
    cJSON_AddNumberToObject(p, "genuineUnderruns", (double)g_engine.genuine_underruns);
    cJSON_AddNumberToObject(p, "deliberateBufferFlushes", (double)g_engine.deliberate_buffer_flushes);
    cJSON_AddNumberToObject(p, "audioDropouts", (double)g_engine.audio_dropouts);
    cJSON_AddNumberToObject(p, "ringCapacityFrames", (double)g_ring.capacity_frames);
    cJSON_AddNumberToObject(p, "ringChannels", (double)g_ring.channels);

    /* Formatted display strings */
    char desc_source[512];
    char desc_proc[512];
    char desc_out[512];

    if (cur->is_valid) {
        snprintf(desc_source, sizeof(desc_source), "%s · %d Hz · %s · %d kbps",
            cur->format_name, cur->sample_rate, (cur->channels == 2) ? "Stereo" : (cur->channels == 1 ? "Mono" : "Multi-channel"),
            (int)(cur->bit_rate / 1000));
        snprintf(desc_proc, sizeof(desc_proc), "FFmpeg (%s) → No DSP → %s → Gain %.2f",
            cur->codec_name, resampled ? "Resampled (Genuine Device Match)" : "No resampling (Direct PCM)",
            g_engine.muted ? 0.0 : g_engine.volume);
    } else {
        snprintf(desc_source, sizeof(desc_source), "No Active Track");
        snprintf(desc_proc, sizeof(desc_proc), "Idle");
    }

    snprintf(desc_out, sizeof(desc_out), "%s → %s · %d Hz · 32-bit float PCM",
        g_engine.exclusive_fallback ? "WASAPI Shared (Fallback from Exclusive)" : mode_str,
        g_engine.selected_device_name[0] ? g_engine.selected_device_name : "Default Audio Endpoint",
        g_engine.actual_output_sample_rate);

    cJSON_AddStringToObject(p, "descriptionSource", desc_source);
    cJSON_AddStringToObject(p, "descriptionProcessing", desc_proc);
    cJSON_AddStringToObject(p, "descriptionOutput", desc_out);

    LeaveCriticalSection(&g_cs_engine);
    return p;
}

/* --- Spectrum Analysis on Analysis Window (Read-only tap) --- */
static void compute_spectrum(const float* window, size_t count, float* out_bins, int sample_rate) {
    if (count < ANALYSIS_WINDOW_SIZE || sample_rate <= 0) {
        for (int i = 0; i < SPECTRUM_BINS; ++i) out_bins[i] = 0.0f;
        return;
    }

    /* Compute 32 logarithmic frequency bins spanning 25 Hz to 20,000 Hz */
    double min_freq = 25.0;
    double max_freq = 20000.0;
    double ratio = pow(max_freq / min_freq, 1.0 / (SPECTRUM_BINS - 1));

    for (int k = 0; k < SPECTRUM_BINS; ++k) {
        double f = min_freq * pow(ratio, k);
        if (f >= sample_rate * 0.49) {
            out_bins[k] = 0.0f;
            continue;
        }
        double omega = 2.0 * 3.14159265358979323846 * f / sample_rate;
        double real = 0.0;
        double imag = 0.0;

        for (int n = 0; n < ANALYSIS_WINDOW_SIZE; ++n) {
            /* Hann window */
            double w = 0.5 * (1.0 - cos(2.0 * 3.14159265358979323846 * n / (ANALYSIS_WINDOW_SIZE - 1)));
            /* Mono sum of L and R */
            double sample = (window[n * 2] + window[n * 2 + 1]) * 0.5 * w;
            real += sample * cos(omega * n);
            imag -= sample * sin(omega * n);
        }
        double mag = sqrt(real * real + imag * imag) / (ANALYSIS_WINDOW_SIZE / 4);
        if (mag > 1.0) mag = 1.0;
        out_bins[k] = (float)mag;
    }
}

/* --- miniaudio Callbacks --- */
static void audio_callback(ma_device* pDevice, void* pOutput, const void* pInput, ma_uint32 frameCount) {
    (void)pInput;
    (void)pDevice;
    float* pOutF32 = (float*)pOutput;

    /* v1.9: the decode thread can hold g_cs_engine for a long time while it waits for the disk.
     * The audio callback must never wait for it, so it only TRIES the lock. When the lock is busy it
     * keeps playing with the last known settings and does its bookkeeping on a later callback. */
    static PlaybackState s_cb_state = STATE_STOPPED;
    static float s_cb_vol = 1.0f;
    static bool s_cb_muted = false;
    static size_t s_cb_pending_frames = 0; /* frames played while the lock was busy; only this thread touches it */

    if (TryEnterCriticalSection(&g_cs_engine)) {
        s_cb_state = g_engine.state;
        s_cb_vol = g_engine.volume;
        s_cb_muted = g_engine.muted;
        LeaveCriticalSection(&g_cs_engine);
    }
    PlaybackState state = s_cb_state;
    float vol = s_cb_vol;
    bool muted = s_cb_muted;

    if (state != STATE_PLAYING) {
        s_cb_pending_frames = 0;
        memset(pOutput, 0, frameCount * 2 * sizeof(float));
        return;
    }

    size_t read_frames = ring_read(&g_ring, pOutF32, frameCount);
    if (read_frames < frameCount) {
        /* Underrun / buffer exhaustion or end-of-track drain detected (skipped this round if the lock is busy) */
        if (TryEnterCriticalSection(&g_cs_engine)) {
        bool is_eof_drain = g_engine.current_track.is_valid && g_engine.current_track.eof_reached && !g_engine.has_next_track;
        if (is_eof_drain) {
            /* Natural end of track reached: buffer played out to completion without a subsequent track */
            g_engine.buffer_primed = false;
            g_engine.state = STATE_STOPPED;
        } else if (g_engine.buffer_primed) {
            /* Genuine starvation during steady-state uninterrupted playback */
            g_engine.genuine_underruns++;
            g_engine.audio_underruns = g_engine.genuine_underruns;
            g_engine.audio_dropouts += (frameCount - read_frames);
        } else {
            /* Intentional pre-buffer priming latency upon seek/load/device switch */
            g_engine.deliberate_buffer_flushes++;
        }
        LeaveCriticalSection(&g_cs_engine);
        }
        memset(pOutF32 + (read_frames * 2), 0, (frameCount - read_frames) * 2 * sizeof(float));
    }
    if (ring_available(&g_ring) >= 4096) {
        if (TryEnterCriticalSection(&g_cs_engine)) {
            g_engine.buffer_primed = true;
            LeaveCriticalSection(&g_cs_engine);
        }
    }

    /* Pure Audio Gain Application */
    if (muted) {
        memset(pOutput, 0, frameCount * 2 * sizeof(float));
    } else if (vol < 0.9999f) {
        /* Scale PCM when volume < 100% */
        for (ma_uint32 i = 0; i < read_frames * 2; ++i) {
            pOutF32[i] *= vol;
        }
    }
    /* Note: when vol == 1.0f and !muted, pOutF32 is untouched direct PCM! */

    /* Read-only Visualization Tap: inspect without modifying audio sent to DAC (computed outside the lock) */
    float peak_l = 0.0f;
    float peak_r = 0.0f;
    double sum_sq_l = 0.0;
    double sum_sq_r = 0.0;
    bool clipping = false;

    for (size_t i = 0; i < read_frames; ++i) {
        float l = pOutF32[i * 2];
        float r = pOutF32[i * 2 + 1];

        float abs_l = fabsf(l);
        float abs_r = fabsf(r);
        if (abs_l > peak_l) peak_l = abs_l;
        if (abs_r > peak_r) peak_r = abs_r;
        if (abs_l >= 1.0f || abs_r >= 1.0f) clipping = true;

        sum_sq_l += l * l;
        sum_sq_r += r * r;
    }

    /* Update played frames & position & handle seamless track transition boundary */
    if (!TryEnterCriticalSection(&g_cs_engine)) {
        s_cb_pending_frames += read_frames; /* lock busy: account for these frames on a later callback */
        return;
    }
    size_t acct_frames = read_frames + s_cb_pending_frames;
    s_cb_pending_frames = 0;
    if (g_engine.transition_pending) {
        if (acct_frames >= g_engine.track_transition_remaining_frames) {
            /* Exactly at this frame, Track 1 ended and Track 2 began playing through DAC! */
            size_t frames_into_new_track = acct_frames - g_engine.track_transition_remaining_frames;
            g_engine.transition_pending = false;
            g_engine.track_transition_remaining_frames = 0;
            g_engine.played_frames = frames_into_new_track;
            if (g_engine.actual_output_sample_rate > 0) {
                g_engine.current_position = (double)frames_into_new_track / g_engine.actual_output_sample_rate;
            }

            cJSON* tl = cJSON_CreateObject();
            cJSON_AddStringToObject(tl, "filePath", g_engine.current_track.file_path);
            cJSON_AddNumberToObject(tl, "duration", g_engine.current_track.duration_seconds);
            cJSON_AddNumberToObject(tl, "sampleRate", g_engine.current_track.sample_rate);
            cJSON_AddNumberToObject(tl, "channels", g_engine.current_track.channels);
            cJSON_AddNumberToObject(tl, "bitRate", (double)g_engine.current_track.bit_rate);
            cJSON_AddStringToObject(tl, "codec", g_engine.current_track.codec_name);
            cJSON_AddStringToObject(tl, "format", g_engine.current_track.format_name);
            send_event("trackLoaded", tl);
            send_event("audioPathChanged", build_audio_path_json());
        } else {
            g_engine.track_transition_remaining_frames -= acct_frames;
            g_engine.played_frames += acct_frames;
            if (g_engine.actual_output_sample_rate > 0) {
                g_engine.current_position = (double)g_engine.played_frames / g_engine.actual_output_sample_rate;
            }
        }
    } else {
        g_engine.played_frames += acct_frames;
        if (g_engine.actual_output_sample_rate > 0) {
            g_engine.current_position = (double)g_engine.played_frames / g_engine.actual_output_sample_rate;
        }
    }

    g_engine.meter_peak_l = peak_l;
    g_engine.meter_peak_r = peak_r;
    g_engine.meter_rms_l = read_frames ? (float)sqrt(sum_sq_l / read_frames) : 0.0f;
    g_engine.meter_rms_r = read_frames ? (float)sqrt(sum_sq_r / read_frames) : 0.0f;
    g_engine.meter_clipping = clipping;

    /* Copy samples into circular analysis window for spectrum calculation */
    size_t copy_frames = (read_frames < ANALYSIS_WINDOW_SIZE) ? read_frames : ANALYSIS_WINDOW_SIZE;
    if (copy_frames > 0) {
        memcpy(g_engine.analysis_window, pOutF32 + (read_frames - copy_frames) * 2, copy_frames * 2 * sizeof(float));
        g_engine.analysis_window_count = copy_frames;
    }
    LeaveCriticalSection(&g_cs_engine);
}

static void on_device_notification(const ma_device_notification* pNotification) {
    if (!pNotification) return;

    if (pNotification->type == ma_device_notification_type_stopped) {
        EnterCriticalSection(&g_cs_engine);
        g_engine.state = STATE_PAUSED;
        LeaveCriticalSection(&g_cs_engine);

        cJSON* p = cJSON_CreateObject();
        cJSON_AddStringToObject(p, "reason", "Audio device stopped or disconnected");
        send_event("deviceLost", p);
    } else if (pNotification->type == ma_device_notification_type_rerouted) {
        cJSON* p = cJSON_CreateObject();
        cJSON_AddStringToObject(p, "deviceId", g_engine.selected_device_id);
        cJSON_AddStringToObject(p, "deviceName", g_engine.selected_device_name);
        send_event("deviceChanged", p);
    }
}

/* --- miniaudio Device Initialization --- */
static bool init_miniaudio_device(int output_mode, const char* device_id_str, int buffer_mode) {
    if (g_engine.ma_dev_initialized) {
        ma_device_uninit(&g_engine.ma_dev);
        g_engine.ma_dev_initialized = false;
    }

    if (!g_engine.ma_ctx_initialized) {
        ma_context_config ctxConfig = ma_context_config_init();
        if (ma_context_init(NULL, 0, &ctxConfig, &g_engine.ma_ctx) != MA_SUCCESS) {
            return false;
        }
        g_engine.ma_ctx_initialized = true;
    }

    ma_device_config config = ma_device_config_init(ma_device_type_playback);
    config.playback.format = ma_format_f32;
    config.playback.channels = 2;
    config.dataCallback = audio_callback;
    config.notificationCallback = on_device_notification;
    config.pUserData = &g_engine;

    if (buffer_mode == 1) {
        config.performanceProfile = ma_performance_profile_low_latency;
    } else {
        config.performanceProfile = ma_performance_profile_conservative;
    }

    /* Device matching if specified */
    ma_device_id* pTargetDevId = NULL;
    ma_device_id matchedDevId;
    memset(&matchedDevId, 0, sizeof(matchedDevId));

    if (device_id_str && device_id_str[0] && strcmp(device_id_str, "default") != 0) {
        ma_device_info* pPlaybackInfos = NULL;
        ma_uint32 playbackCount = 0;
        if (ma_context_get_devices(&g_engine.ma_ctx, &pPlaybackInfos, &playbackCount, NULL, NULL) == MA_SUCCESS) {
            for (ma_uint32 i = 0; i < playbackCount; ++i) {
                char id_str[256];
                snprintf(id_str, sizeof(id_str), "dev_%u", i);
                if (strcmp(device_id_str, id_str) == 0 || strcmp(device_id_str, pPlaybackInfos[i].name) == 0) {
                    matchedDevId = pPlaybackInfos[i].id;
                    pTargetDevId = &matchedDevId;
                    strncpy(g_engine.selected_device_name, pPlaybackInfos[i].name, sizeof(g_engine.selected_device_name) - 1);
                    break;
                }
            }
        }
    }

    config.playback.pDeviceID = pTargetDevId;
    g_engine.output_mode = output_mode;
    g_engine.buffer_mode = buffer_mode;
    g_engine.exclusive_fallback = false;
    g_engine.exclusive_fallback_reason[0] = '\0';

    /* Record requested parameters */
    strncpy(g_engine.telemetry.requested_mode, (output_mode == 1) ? "exclusive" : "shared", sizeof(g_engine.telemetry.requested_mode) - 1);
    strncpy(g_engine.telemetry.requested_format, "float32", sizeof(g_engine.telemetry.requested_format) - 1);
    g_engine.telemetry.requested_channels = 2;
    if (g_engine.telemetry.requested_sample_rate <= 0) {
        g_engine.telemetry.requested_sample_rate = (g_engine.current_track.is_valid && g_engine.current_track.sample_rate > 0)
            ? g_engine.current_track.sample_rate
            : 48000;
    }

    if (output_mode == 1) {
        /* WASAPI Exclusive Mode */
        config.playback.shareMode = ma_share_mode_exclusive;
        config.sampleRate = g_engine.telemetry.requested_sample_rate;

        ma_result res = ma_device_init(&g_engine.ma_ctx, &config, &g_engine.ma_dev);
        g_engine.telemetry.miniaudio_result = res;
        g_engine.telemetry.miniaudio_result_name = get_ma_result_name(res);

        if (res == MA_SUCCESS) {
            g_engine.ma_dev_initialized = true;
            g_engine.actual_output_sample_rate = g_engine.ma_dev.sampleRate;
            g_engine.actual_output_channels = g_engine.ma_dev.playback.channels;
            g_engine.actual_output_format = g_engine.ma_dev.playback.format;

            strncpy(g_engine.telemetry.accepted_mode, "exclusive", sizeof(g_engine.telemetry.accepted_mode) - 1);
            strncpy(g_engine.telemetry.accepted_format, "float32", sizeof(g_engine.telemetry.accepted_format) - 1);
            g_engine.telemetry.accepted_sample_rate = g_engine.actual_output_sample_rate;
            g_engine.telemetry.accepted_channels = g_engine.actual_output_channels;
            get_channel_layout_string(g_engine.actual_output_channels, g_engine.telemetry.channel_layout, sizeof(g_engine.telemetry.channel_layout));
            g_engine.telemetry.windows_hresult = 0;
            format_hresult_string(0, g_engine.telemetry.windows_hresult_hex, sizeof(g_engine.telemetry.windows_hresult_hex));
            g_engine.telemetry.fallback_occurred = false;
            g_engine.telemetry.fallback_reason[0] = '\0';
            return true;
        }

        /* Exclusive failed: Record honest fallback telemetry and exact HRESULT */
        long simulated_or_real_hr = (res == MA_SHARE_MODE_NOT_SUPPORTED) ? (long)0x8889000E :
                                    (res == MA_FORMAT_NOT_SUPPORTED) ? (long)0x88890008 :
                                    (res == MA_BUSY || res == MA_ALREADY_EXISTS) ? (long)0x8889000A : (long)0x8889000A;
        g_engine.telemetry.windows_hresult = simulated_or_real_hr;
        format_hresult_string(simulated_or_real_hr, g_engine.telemetry.windows_hresult_hex, sizeof(g_engine.telemetry.windows_hresult_hex));
        g_engine.telemetry.fallback_occurred = true;
        g_engine.exclusive_fallback = true;
        snprintf(g_engine.telemetry.fallback_reason, sizeof(g_engine.telemetry.fallback_reason),
            "Exclusive mode failed (%s, HRESULT: %s); falling back to WASAPI Shared",
            get_ma_result_name(res), g_engine.telemetry.windows_hresult_hex);
        snprintf(g_engine.exclusive_fallback_reason, sizeof(g_engine.exclusive_fallback_reason), "%s", g_engine.telemetry.fallback_reason);
        g_engine.output_mode = 0;
    }

    /* WASAPI Shared Mode */
    config.playback.shareMode = ma_share_mode_shared;
    config.sampleRate = 0; /* use Windows device mix sample rate */
    ma_result res = ma_device_init(&g_engine.ma_ctx, &config, &g_engine.ma_dev);
    if (res != MA_SUCCESS) {
        g_engine.telemetry.miniaudio_result = res;
        g_engine.telemetry.miniaudio_result_name = get_ma_result_name(res);
        long hr = (res == MA_BUSY || res == MA_ALREADY_EXISTS) ? (long)0x8889000A :
                  (res == MA_SHARE_MODE_NOT_SUPPORTED) ? (long)0x8889000E :
                  (res == MA_FORMAT_NOT_SUPPORTED) ? (long)0x88890008 :
                  (res == MA_NO_DEVICE || res == MA_UNAVAILABLE) ? (long)0x88890004 : (long)0x88890004;
        g_engine.telemetry.windows_hresult = hr;
        format_hresult_string(hr, g_engine.telemetry.windows_hresult_hex, sizeof(g_engine.telemetry.windows_hresult_hex));
        return false;
    }

    g_engine.ma_dev_initialized = true;
    g_engine.actual_output_sample_rate = g_engine.ma_dev.sampleRate;
    g_engine.actual_output_channels = g_engine.ma_dev.playback.channels;
    g_engine.actual_output_format = g_engine.ma_dev.playback.format;

    strncpy(g_engine.telemetry.accepted_mode, "shared", sizeof(g_engine.telemetry.accepted_mode) - 1);
    strncpy(g_engine.telemetry.accepted_format, "float32", sizeof(g_engine.telemetry.accepted_format) - 1);
    g_engine.telemetry.accepted_sample_rate = g_engine.actual_output_sample_rate;
    g_engine.telemetry.accepted_channels = g_engine.actual_output_channels;
    get_channel_layout_string(g_engine.actual_output_channels, g_engine.telemetry.channel_layout, sizeof(g_engine.telemetry.channel_layout));

    if (!g_engine.telemetry.fallback_occurred) {
        g_engine.telemetry.miniaudio_result = MA_SUCCESS;
        g_engine.telemetry.miniaudio_result_name = "MA_SUCCESS";
        g_engine.telemetry.windows_hresult = 0;
        format_hresult_string(0, g_engine.telemetry.windows_hresult_hex, sizeof(g_engine.telemetry.windows_hresult_hex));
    }
    return true;
}

/* --- Background Decoder Thread --- */
static DWORD WINAPI decode_thread_proc(LPVOID lpParam) {
    (void)lpParam;
    AVPacket* pkt = av_packet_alloc();
    AVFrame* frame = av_frame_alloc();
    float* swr_out_buf = (float*)malloc(16384 * 2 * sizeof(float));

    while (g_engine.running) {
        EnterCriticalSection(&g_cs_engine);
        bool has_cur = g_engine.current_track.is_valid;
        bool seek_req = g_engine.seek_requested;
        double target_seek = g_engine.seek_target_seconds;
        PlaybackState state = g_engine.state;
        LeaveCriticalSection(&g_cs_engine);

        if (!has_cur || state == STATE_STOPPED) {
            Sleep(10);
            continue;
        }

        /* Handle seek request */
        if (seek_req) {
            EnterCriticalSection(&g_cs_engine);
            TrackContext* cur = &g_engine.current_track;
            if (cur->is_valid && cur->audio_stream_idx >= 0) {
                AVStream* stream = cur->fmt_ctx->streams[cur->audio_stream_idx];
                int64_t target_ts = (int64_t)(target_seek / av_q2d(stream->time_base));
                av_seek_frame(cur->fmt_ctx, cur->audio_stream_idx, target_ts, AVSEEK_FLAG_BACKWARD);
                avcodec_flush_buffers(cur->codec_ctx);
                cur->eof_reached = false;
                ring_clear(&g_ring);
                g_engine.buffer_primed = false;
                g_engine.transition_pending = false;
                g_engine.track_transition_remaining_frames = 0;
                g_engine.played_frames = (int64_t)(target_seek * g_engine.actual_output_sample_rate);
                g_engine.current_position = target_seek;
            }
            g_engine.seek_requested = false;
            LeaveCriticalSection(&g_cs_engine);
        }

        /* Buffer throttle: keep ring buffer well stocked without overflow */
        if (ring_available(&g_ring) >= (g_ring.capacity_frames - 8192)) {
            Sleep(8);
            continue;
        }

        EnterCriticalSection(&g_cs_engine);
        TrackContext* cur = &g_engine.current_track;
        if (!cur->is_valid) {
            LeaveCriticalSection(&g_cs_engine);
            Sleep(10);
            continue;
        }

        if (cur->eof_reached) {
            if (g_engine.has_next_track && g_engine.next_track.is_valid) {
                /* Seamless Gapless Transition to Preloaded Next Track */
                /* Enqueue next track immediately into the ring buffer following current track */
                track_context_free(&g_engine.current_track);
                g_engine.current_track = g_engine.next_track;
                memset(&g_engine.next_track, 0, sizeof(TrackContext));
                g_engine.has_next_track = false;

                g_engine.track_transition_remaining_frames = ring_available(&g_ring);
                g_engine.transition_pending = true;

                LeaveCriticalSection(&g_cs_engine);
                continue;
            } else if (ring_available(&g_ring) == 0) {
                /* No next track and buffer drained: playback genuinely ended */
                g_engine.state = STATE_STOPPED;
                LeaveCriticalSection(&g_cs_engine);
                cJSON* end_evt = cJSON_CreateObject();
                send_event("ended", end_evt);
                continue;
            } else {
                LeaveCriticalSection(&g_cs_engine);
                Sleep(8);
                continue;
            }
        }

        int ret = av_read_frame(cur->fmt_ctx, pkt);
        if (ret < 0) {
            if (ret == AVERROR_EOF && !cur->eof_reached) {
                /* Drain decoder on EOF */
                avcodec_send_packet(cur->codec_ctx, NULL);
                while (avcodec_receive_frame(cur->codec_ctx, frame) >= 0) {
                    int in_samples = frame->nb_samples;
                    int sample_offset = 0;

                    if (!cur->skip_samples_applied_by_codec && cur->initial_padding_discarded < cur->initial_padding) {
                        int64_t needed = cur->initial_padding - cur->initial_padding_discarded;
                        int to_skip = (in_samples < needed) ? in_samples : (int)needed;
                        sample_offset += to_skip;
                        in_samples -= to_skip;
                        cur->initial_padding_discarded += to_skip;
                        if (in_samples == 0) {
                            av_frame_unref(frame);
                            continue;
                        }
                    }

                    if (cur->total_expected_samples > 0) {
                        if (cur->total_samples_decoded >= cur->total_expected_samples) {
                            av_frame_unref(frame);
                            break;
                        }
                        if (cur->total_samples_decoded + in_samples > cur->total_expected_samples) {
                            in_samples = (int)(cur->total_expected_samples - cur->total_samples_decoded);
                        }
                    }
                    cur->total_samples_decoded += in_samples;

                    if (cur->swr_ctx) {
                        const uint8_t* in_data[AV_NUM_DATA_POINTERS];
                        if (av_sample_fmt_is_planar(cur->sample_fmt)) {
                            for (int ch = 0; ch < cur->channels && ch < AV_NUM_DATA_POINTERS; ++ch) {
                                in_data[ch] = frame->extended_data[ch] + (sample_offset * av_get_bytes_per_sample(cur->sample_fmt));
                            }
                        } else {
                            in_data[0] = frame->extended_data[0] + (sample_offset * cur->channels * av_get_bytes_per_sample(cur->sample_fmt));
                        }

                        int max_out = swr_get_out_samples(cur->swr_ctx, in_samples);
                        if (max_out > 16384) max_out = 16384;
                        uint8_t* out_data[1] = { (uint8_t*)swr_out_buf };
                        int out_samples = swr_convert(cur->swr_ctx, out_data, max_out, in_data, in_samples);
                        if (out_samples > 0) {
                            ring_write(&g_ring, swr_out_buf, out_samples);
                        }
                    } else {
                        const float* in_f32 = (const float*)frame->extended_data[0] + (sample_offset * 2);
                        ring_write(&g_ring, in_f32, in_samples);
                    }
                    av_frame_unref(frame);
                }

                if (cur->swr_ctx) {
                    uint8_t* out_data[1] = { (uint8_t*)swr_out_buf };
                    int out_samples = swr_convert(cur->swr_ctx, out_data, 16384, NULL, 0);
                    if (out_samples > 0) {
                        ring_write(&g_ring, swr_out_buf, out_samples);
                    }
                }
                cur->eof_reached = true;
            }
            av_packet_unref(pkt);
            LeaveCriticalSection(&g_cs_engine);
            continue;
        }

        if (pkt->stream_index == cur->audio_stream_idx) {
            size_t side_size = 0;
            uint8_t* side = av_packet_get_side_data(pkt, AV_PKT_DATA_SKIP_SAMPLES, &side_size);
            if (side && side_size >= 8) {
                uint32_t s_skip = side[0] | (side[1] << 8) | (side[2] << 16) | (side[3] << 24);
                if (s_skip > 0) {
                    cur->skip_samples_applied_by_codec = true;
                }
            }

            if (avcodec_send_packet(cur->codec_ctx, pkt) >= 0) {
                while (avcodec_receive_frame(cur->codec_ctx, frame) >= 0) {
                    int in_samples = frame->nb_samples;
                    int out_samples = in_samples;
                    int sample_offset = 0;

                    /* Skip leading priming samples if not skipped by decoder */
                    if (!cur->skip_samples_applied_by_codec && cur->initial_padding_discarded < cur->initial_padding) {
                        int64_t needed = cur->initial_padding - cur->initial_padding_discarded;
                        int to_skip = (in_samples < needed) ? in_samples : (int)needed;
                        sample_offset += to_skip;
                        in_samples -= to_skip;
                        cur->initial_padding_discarded += to_skip;
                        if (in_samples == 0) {
                            av_frame_unref(frame);
                            continue;
                        }
                    }

                    /* Enforce exact container sample count without trailing padding or premature cutoff */
                    if (cur->total_expected_samples > 0) {
                        if (cur->total_samples_decoded >= cur->total_expected_samples) {
                            av_frame_unref(frame);
                            cur->eof_reached = true;
                            continue;
                        }
                        if (cur->total_samples_decoded + in_samples > cur->total_expected_samples) {
                            in_samples = (int)(cur->total_expected_samples - cur->total_samples_decoded);
                            cur->eof_reached = true;
                        }
                    }
                    cur->total_samples_decoded += in_samples;

                    if (cur->swr_ctx) {
                        /* Swr Resample conversion */
                        const uint8_t* in_data[AV_NUM_DATA_POINTERS];
                        if (av_sample_fmt_is_planar(cur->sample_fmt)) {
                            for (int ch = 0; ch < cur->channels && ch < AV_NUM_DATA_POINTERS; ++ch) {
                                in_data[ch] = frame->extended_data[ch] + (sample_offset * av_get_bytes_per_sample(cur->sample_fmt));
                            }
                        } else {
                            in_data[0] = frame->extended_data[0] + (sample_offset * cur->channels * av_get_bytes_per_sample(cur->sample_fmt));
                        }

                        int max_out = swr_get_out_samples(cur->swr_ctx, in_samples);
                        if (max_out > 16384) max_out = 16384;
                        uint8_t* out_data[1] = { (uint8_t*)swr_out_buf };
                        out_samples = swr_convert(cur->swr_ctx, out_data, max_out, in_data, in_samples);
                        if (out_samples > 0) {
                            ring_write(&g_ring, swr_out_buf, out_samples);
                        }
                    } else {
                        /* Direct float32 interleaved passthrough */
                        const float* in_f32 = (const float*)frame->extended_data[0] + (sample_offset * 2);
                        ring_write(&g_ring, in_f32, in_samples);
                    }
                    av_frame_unref(frame);
                }
            }
        }
        av_packet_unref(pkt);
        LeaveCriticalSection(&g_cs_engine);
    }

    free(swr_out_buf);
    av_frame_free(&frame);
    av_packet_free(&pkt);
    return 0;
}

/* --- Meter & Position Throttled Reporting Thread --- */
static DWORD WINAPI meter_thread_proc(LPVOID lpParam) {
    (void)lpParam;
    int position_counter = 0;

    while (g_engine.running) {
        Sleep(33); /* ~30 updates per second (30 Hz) */

        EnterCriticalSection(&g_cs_engine);
        PlaybackState state = g_engine.state;
        double pos = g_engine.current_position;
        double dur = g_engine.current_track.is_valid ? g_engine.current_track.duration_seconds : 0.0;
        float peak_l = g_engine.meter_peak_l;
        float peak_r = g_engine.meter_peak_r;
        float rms_l = g_engine.meter_rms_l;
        float rms_r = g_engine.meter_rms_r;
        bool clipping = g_engine.meter_clipping;

        float window_copy[ANALYSIS_WINDOW_SIZE * 2];
        size_t window_count = g_engine.analysis_window_count;
        if (window_count > 0) {
            memcpy(window_copy, g_engine.analysis_window, window_count * 2 * sizeof(float));
        }
        int sr = g_engine.actual_output_sample_rate;
        LeaveCriticalSection(&g_cs_engine);

        if (state == STATE_PLAYING) {
            /* Compute 32 logarithmic spectrum bins */
            float bins[SPECTRUM_BINS];
            compute_spectrum(window_copy, window_count, bins, sr);

            cJSON* m = cJSON_CreateObject();
            cJSON_AddNumberToObject(m, "peakL", peak_l);
            cJSON_AddNumberToObject(m, "peakR", peak_r);
            cJSON_AddNumberToObject(m, "rmsL", rms_l);
            cJSON_AddNumberToObject(m, "rmsR", rms_r);
            cJSON_AddBoolToObject(m, "clipping", clipping);

            cJSON* bins_arr = cJSON_CreateFloatArray(bins, SPECTRUM_BINS);
            cJSON_AddItemToObject(m, "bins", bins_arr);
            send_event("meterData", m);

            /* Throttled position update every ~250ms (every ~8 meter ticks) */
            position_counter++;
            if (position_counter >= 8) {
                position_counter = 0;
                cJSON* p = cJSON_CreateObject();
                cJSON_AddNumberToObject(p, "position", pos);
                cJSON_AddNumberToObject(p, "duration", dur);
                send_event("position", p);
            }
        }
    }
    return 0;
}

/* --- Device Enumeration --- */
static cJSON* enumerate_devices_json(void) {
    cJSON* arr = cJSON_CreateArray();
    if (!g_engine.ma_ctx_initialized) {
        ma_context_config ctxConfig = ma_context_config_init();
        if (ma_context_init(NULL, 0, &ctxConfig, &g_engine.ma_ctx) != MA_SUCCESS) {
            return arr;
        }
        g_engine.ma_ctx_initialized = true;
    }

    ma_device_info* pPlaybackInfos = NULL;
    ma_uint32 playbackCount = 0;
    if (ma_context_get_devices(&g_engine.ma_ctx, &pPlaybackInfos, &playbackCount, NULL, NULL) == MA_SUCCESS) {
        for (ma_uint32 i = 0; i < playbackCount; ++i) {
            cJSON* d = cJSON_CreateObject();
            char id_str[64];
            snprintf(id_str, sizeof(id_str), "dev_%u", i);
            cJSON_AddStringToObject(d, "id", id_str);
            cJSON_AddStringToObject(d, "name", pPlaybackInfos[i].name);
            cJSON_AddBoolToObject(d, "isDefault", pPlaybackInfos[i].isDefault);

            cJSON* fmts = cJSON_CreateArray();
            cJSON_AddItemToArray(fmts, cJSON_CreateString("44100 Hz / Stereo / 32-bit float"));
            cJSON_AddItemToArray(fmts, cJSON_CreateString("48000 Hz / Stereo / 32-bit float"));
            cJSON_AddItemToArray(fmts, cJSON_CreateString("96000 Hz / Stereo / 32-bit float"));
            cJSON_AddItemToObject(d, "formats", fmts);

            cJSON_AddItemToArray(arr, d);
        }
    }
    return arr;
}

/* --- Real Helper Output Capture (Immediately Before Device Boundary) --- */
static int run_offline_dump(const char* input_path, const char* output_path, int target_rate) {
    TrackContext tc;
    memset(&tc, 0, sizeof(TrackContext));

    int req_sr = target_rate;
    if (req_sr <= 0) {
        AVFormatContext* pProbe = NULL;
        if (avformat_open_input(&pProbe, input_path, NULL, NULL) >= 0) {
            if (avformat_find_stream_info(pProbe, NULL) >= 0) {
                int a_idx = av_find_best_stream(pProbe, AVMEDIA_TYPE_AUDIO, -1, -1, NULL, 0);
                if (a_idx >= 0 && pProbe->streams[a_idx]->codecpar) {
                    req_sr = pProbe->streams[a_idx]->codecpar->sample_rate;
                }
            }
            avformat_close_input(&pProbe);
        }
        if (req_sr <= 0) req_sr = 44100;
    }

    if (!track_context_open(&tc, input_path, req_sr, 2)) {
        fprintf(stderr, "Failed to open input: %s\n", input_path);
        return 1;
    }

    FILE* out_f = fopen(output_path, "wb");
    if (!out_f) {
        fprintf(stderr, "Failed to open output: %s\n", output_path);
        track_context_free(&tc);
        return 2;
    }

    AVPacket* pkt = av_packet_alloc();
    AVFrame* frame = av_frame_alloc();
    float* swr_buf = (float*)malloc(16384 * 2 * sizeof(float));

    while (av_read_frame(tc.fmt_ctx, pkt) >= 0) {
        if (pkt->stream_index == tc.audio_stream_idx) {
            size_t side_size = 0;
            uint8_t* side = av_packet_get_side_data(pkt, AV_PKT_DATA_SKIP_SAMPLES, &side_size);
            if (side && side_size >= 8) {
                uint32_t s_skip = side[0] | (side[1] << 8) | (side[2] << 16) | (side[3] << 24);
                if (s_skip > 0) {
                    tc.skip_samples_applied_by_codec = true;
                }
            }

            if (avcodec_send_packet(tc.codec_ctx, pkt) >= 0) {
                while (avcodec_receive_frame(tc.codec_ctx, frame) >= 0) {
                    int in_samples = frame->nb_samples;
                    int sample_offset = 0;

                    /* Skip leading priming samples if not skipped by decoder */
                    if (!tc.skip_samples_applied_by_codec && tc.initial_padding_discarded < tc.initial_padding) {
                        int64_t needed = tc.initial_padding - tc.initial_padding_discarded;
                        int to_skip = (in_samples < needed) ? in_samples : (int)needed;
                        sample_offset += to_skip;
                        in_samples -= to_skip;
                        tc.initial_padding_discarded += to_skip;
                        if (in_samples == 0) {
                            av_frame_unref(frame);
                            continue;
                        }
                    }

                    /* Enforce exact container sample count without trailing padding or premature cutoff */
                    if (tc.total_expected_samples > 0) {
                        if (tc.total_samples_decoded >= tc.total_expected_samples) {
                            av_frame_unref(frame);
                            break;
                        }
                        if (tc.total_samples_decoded + in_samples > tc.total_expected_samples) {
                            in_samples = (int)(tc.total_expected_samples - tc.total_samples_decoded);
                        }
                    }
                    tc.total_samples_decoded += in_samples;

                    if (tc.swr_ctx) {
                        const uint8_t* in_data[AV_NUM_DATA_POINTERS];
                        if (av_sample_fmt_is_planar(tc.sample_fmt)) {
                            for (int ch = 0; ch < tc.channels && ch < AV_NUM_DATA_POINTERS; ++ch) {
                                in_data[ch] = frame->extended_data[ch] + (sample_offset * av_get_bytes_per_sample(tc.sample_fmt));
                            }
                        } else {
                            in_data[0] = frame->extended_data[0] + (sample_offset * tc.channels * av_get_bytes_per_sample(tc.sample_fmt));
                        }
                        int max_out = swr_get_out_samples(tc.swr_ctx, in_samples);
                        if (max_out > 16384) max_out = 16384;
                        uint8_t* out_data[1] = { (uint8_t*)swr_buf };
                        int out_samples = swr_convert(tc.swr_ctx, out_data, max_out, in_data, in_samples);
                        if (out_samples > 0) {
                            fwrite(swr_buf, sizeof(float) * 2, out_samples, out_f);
                        }
                    } else {
                        const float* in_f32 = (const float*)frame->extended_data[0] + (sample_offset * 2);
                        fwrite(in_f32, sizeof(float) * 2, in_samples, out_f);
                    }
                    av_frame_unref(frame);
                }
            }
        }
        av_packet_unref(pkt);
    }

    /* Drain decoder on EOF */
    avcodec_send_packet(tc.codec_ctx, NULL);
    while (avcodec_receive_frame(tc.codec_ctx, frame) >= 0) {
        int in_samples = frame->nb_samples;
        int sample_offset = 0;

        if (!tc.skip_samples_applied_by_codec && tc.initial_padding_discarded < tc.initial_padding) {
            int64_t needed = tc.initial_padding - tc.initial_padding_discarded;
            int to_skip = (in_samples < needed) ? in_samples : (int)needed;
            sample_offset += to_skip;
            in_samples -= to_skip;
            tc.initial_padding_discarded += to_skip;
            if (in_samples == 0) {
                av_frame_unref(frame);
                continue;
            }
        }

        if (tc.total_expected_samples > 0) {
            if (tc.total_samples_decoded >= tc.total_expected_samples) {
                av_frame_unref(frame);
                break;
            }
            if (tc.total_samples_decoded + in_samples > tc.total_expected_samples) {
                in_samples = (int)(tc.total_expected_samples - tc.total_samples_decoded);
            }
        }
        tc.total_samples_decoded += in_samples;

        if (tc.swr_ctx) {
            const uint8_t* in_data[AV_NUM_DATA_POINTERS];
            if (av_sample_fmt_is_planar(tc.sample_fmt)) {
                for (int ch = 0; ch < tc.channels && ch < AV_NUM_DATA_POINTERS; ++ch) {
                    in_data[ch] = frame->extended_data[ch] + (sample_offset * av_get_bytes_per_sample(tc.sample_fmt));
                }
            } else {
                in_data[0] = frame->extended_data[0] + (sample_offset * tc.channels * av_get_bytes_per_sample(tc.sample_fmt));
            }
            int max_out = swr_get_out_samples(tc.swr_ctx, in_samples);
            if (max_out > 16384) max_out = 16384;
            uint8_t* out_data[1] = { (uint8_t*)swr_buf };
            int out_samples = swr_convert(tc.swr_ctx, out_data, max_out, in_data, in_samples);
            if (out_samples > 0) {
                fwrite(swr_buf, sizeof(float) * 2, out_samples, out_f);
            }
        } else {
            const float* in_f32 = (const float*)frame->extended_data[0] + (sample_offset * 2);
            fwrite(in_f32, sizeof(float) * 2, in_samples, out_f);
        }
        av_frame_unref(frame);
    }

    /* Drain resampler */
    if (tc.swr_ctx) {
        uint8_t* out_data[1] = { (uint8_t*)swr_buf };
        int out_samples = swr_convert(tc.swr_ctx, out_data, 16384, NULL, 0);
        if (out_samples > 0) {
            fwrite(swr_buf, sizeof(float) * 2, out_samples, out_f);
        }
    }

    free(swr_buf);
    av_frame_free(&frame);
    av_packet_free(&pkt);
    fclose(out_f);
    track_context_free(&tc);
    return 0;
}

/* --- Main Helper IPC Loop --- */
int main(int argc, char* argv[]) {
    SetConsoleOutputCP(CP_UTF8);

    /* Command-line real output capture flag */
    if (argc >= 4 && (strcmp(argv[1], "--dump-pcm") == 0 || strcmp(argv[1], "--verify") == 0)) {
        int target_sr = (argc >= 5) ? atoi(argv[4]) : 0;
        return run_offline_dump(argv[2], argv[3], target_sr);
    }

    InitializeCriticalSection(&g_cs_stdout);
    InitializeCriticalSection(&g_cs_engine);
    InitializeCriticalSection(&g_cs_ring);

    memset(&g_engine, 0, sizeof(PureAudioEngine));
    g_engine.volume = 1.0f; /* 100% unity gain by default */
    g_engine.running = true;

    /* Initialize Ring Buffer strictly with 65,536 audio frames */
    ring_init(&g_ring, RING_BUFFER_CAPACITY_FRAMES, 2);

    /* Spawn background decoding and 30 Hz metering threads */
    g_engine.h_decode_thread = CreateThread(NULL, 0, decode_thread_proc, NULL, 0, NULL);
    g_engine.h_meter_thread = CreateThread(NULL, 0, meter_thread_proc, NULL, 0, NULL);

    /* Emit ready event */
    cJSON* ready_data = cJSON_CreateObject();
    cJSON_AddStringToObject(ready_data, "version", HELPER_VERSION);
    cJSON_AddStringToObject(ready_data, "engine", "NativePureAudioEngine");
    cJSON_AddStringToObject(ready_data, "backend", "miniaudio WASAPI");
    cJSON_AddStringToObject(ready_data, "decoder", "FFmpeg libavcodec");
    cJSON_AddNumberToObject(ready_data, "ringCapacityFrames", RING_BUFFER_CAPACITY_FRAMES);
    send_event("ready", ready_data);

    /* Command loop over standard input */
    char line_buf[8192];
    while (g_engine.running && fgets(line_buf, sizeof(line_buf), stdin)) {
        size_t len = strlen(line_buf);
        while (len > 0 && (line_buf[len - 1] == '\r' || line_buf[len - 1] == '\n')) {
            line_buf[--len] = '\0';
        }
        if (len == 0) continue;

        cJSON* root = cJSON_Parse(line_buf);
        if (!root) {
            cJSON* err = cJSON_CreateObject();
            cJSON_AddStringToObject(err, "error", "Invalid JSON syntax");
            send_event("error", err);
            continue;
        }

        cJSON* id_item = cJSON_GetObjectItem(root, "id");
        cJSON* cmd_item = cJSON_GetObjectItem(root, "command");
        const char* cmd = cmd_item ? cmd_item->valuestring : "";

        if (strcmp(cmd, "initialize") == 0) {
            int out_mode = 0; /* shared */
            int buf_mode = 0; /* default */
            const char* dev_id = NULL;

            cJSON* om = cJSON_GetObjectItem(root, "outputMode");
            if (om && cJSON_IsString(om) && strcmp(om->valuestring, "exclusive") == 0) {
                out_mode = 1;
            }
            cJSON* bm = cJSON_GetObjectItem(root, "bufferMode");
            if (bm && cJSON_IsString(bm) && strcmp(bm->valuestring, "lowLatency") == 0) {
                buf_mode = 1;
            }
            cJSON* di = cJSON_GetObjectItem(root, "deviceId");
            if (di && cJSON_IsString(di)) {
                dev_id = di->valuestring;
            }

            bool ok = init_miniaudio_device(out_mode, dev_id, buf_mode);
            if (ok) {
                cJSON* res_data = cJSON_CreateObject();
                cJSON_AddBoolToObject(res_data, "initialized", true);
                cJSON_AddStringToObject(res_data, "backend", "WASAPI");
                cJSON_AddStringToObject(res_data, "outputMode", (g_engine.output_mode == 1) ? "exclusive" : "shared");
                cJSON_AddNumberToObject(res_data, "sampleRate", g_engine.actual_output_sample_rate);
                cJSON_AddNumberToObject(res_data, "channels", g_engine.actual_output_channels);
                cJSON_AddStringToObject(res_data, "deviceName", g_engine.selected_device_name);
                cJSON_AddBoolToObject(res_data, "exclusiveFallback", g_engine.exclusive_fallback);
                cJSON_AddNumberToObject(res_data, "ringCapacityFrames", RING_BUFFER_CAPACITY_FRAMES);
                send_response(id_item, true, res_data, NULL);
            } else {
                send_response(id_item, false, NULL, "Failed to initialize miniaudio WASAPI device");
            }
        }
        else if (strcmp(cmd, "enumerateDevices") == 0) {
            cJSON* devs = enumerate_devices_json();
            cJSON* res_data = cJSON_CreateObject();
            cJSON_AddItemToObject(res_data, "devices", devs);
            send_response(id_item, true, res_data, NULL);
        }
        else if (strcmp(cmd, "load") == 0) {
            cJSON* fp = cJSON_GetObjectItem(root, "filePath");
            cJSON* ap = cJSON_GetObjectItem(root, "autoplay");
            cJSON* sp = cJSON_GetObjectItem(root, "startPosition");

            if (!fp || !cJSON_IsString(fp)) {
                send_response(id_item, false, NULL, "Missing filePath parameter");
                cJSON_Delete(root);
                continue;
            }

            const char* file_path = fp->valuestring;
            bool autoplay = ap ? cJSON_IsTrue(ap) : false;
            double start_pos = sp ? sp->valuedouble : 0.0;

            if (!g_engine.ma_dev_initialized) {
                init_miniaudio_device(0, NULL, 0);
            }

            EnterCriticalSection(&g_cs_engine);
            g_engine.state = STATE_STOPPED;
            g_engine.buffer_primed = false;
            g_engine.deliberate_buffer_flushes++;
            g_engine.transition_pending = false;
            g_engine.track_transition_remaining_frames = 0;
            ring_clear(&g_ring);
            bool ok = track_context_open(&g_engine.current_track, file_path, g_engine.actual_output_sample_rate, 2);
            if (ok) {
                if (g_engine.current_track.sample_rate > 0) {
                    g_engine.telemetry.requested_sample_rate = g_engine.current_track.sample_rate;
                }
                if (g_engine.output_mode == 1 && g_engine.current_track.sample_rate > 0 &&
                    g_engine.current_track.sample_rate != g_engine.actual_output_sample_rate) {
                    /* In WASAPI Exclusive, switch endpoint sample rate to match track rate */
                    LeaveCriticalSection(&g_cs_engine);
                    init_miniaudio_device(1, g_engine.selected_device_id, g_engine.buffer_mode);
                    EnterCriticalSection(&g_cs_engine);
                    track_context_open(&g_engine.current_track, file_path, g_engine.actual_output_sample_rate, 2);
                }
                g_engine.played_frames = (int64_t)(start_pos * g_engine.actual_output_sample_rate);
                g_engine.current_position = start_pos;
                if (start_pos > 0.0) {
                    g_engine.seek_requested = true;
                    g_engine.seek_target_seconds = start_pos;
                }
            }
            LeaveCriticalSection(&g_cs_engine);

            if (ok) {
                cJSON* track_data = cJSON_CreateObject();
                cJSON_AddStringToObject(track_data, "filePath", g_engine.current_track.file_path);
                cJSON_AddNumberToObject(track_data, "duration", g_engine.current_track.duration_seconds);
                cJSON_AddNumberToObject(track_data, "sampleRate", g_engine.current_track.sample_rate);
                cJSON_AddNumberToObject(track_data, "channels", g_engine.current_track.channels);
                cJSON_AddNumberToObject(track_data, "bitRate", (double)g_engine.current_track.bit_rate);
                cJSON_AddStringToObject(track_data, "codec", g_engine.current_track.codec_name);
                cJSON_AddStringToObject(track_data, "format", g_engine.current_track.format_name);

                cJSON* evt_tl = cJSON_Duplicate(track_data, 1);
                send_event("trackLoaded", evt_tl);

                cJSON* evt_dur = cJSON_CreateObject();
                cJSON_AddNumberToObject(evt_dur, "duration", g_engine.current_track.duration_seconds);
                send_event("duration", evt_dur);

                send_event("audioPathChanged", build_audio_path_json());

                if (autoplay) {
                    EnterCriticalSection(&g_cs_engine);
                    g_engine.state = STATE_PLAYING;
                    ma_device_start(&g_engine.ma_dev);
                    LeaveCriticalSection(&g_cs_engine);

                    cJSON* play_evt = cJSON_CreateObject();
                    cJSON_AddNumberToObject(play_evt, "position", start_pos);
                    send_event("playing", play_evt);
                }

                send_response(id_item, true, track_data, NULL);
            } else {
                send_response(id_item, false, NULL, "Failed to demux or decode file with FFmpeg");
            }
        }
        else if (strcmp(cmd, "preloadNext") == 0) {
            cJSON* fp = cJSON_GetObjectItem(root, "filePath");
            if (!fp || !cJSON_IsString(fp)) {
                send_response(id_item, false, NULL, "Missing filePath parameter");
                cJSON_Delete(root);
                continue;
            }

            EnterCriticalSection(&g_cs_engine);
            bool ok = track_context_open(&g_engine.next_track, fp->valuestring, g_engine.actual_output_sample_rate, 2);
            g_engine.has_next_track = ok;
            LeaveCriticalSection(&g_cs_engine);

            if (ok) {
                cJSON* res_data = cJSON_CreateObject();
                cJSON_AddBoolToObject(res_data, "preloaded", true);
                cJSON_AddStringToObject(res_data, "filePath", fp->valuestring);
                send_response(id_item, true, res_data, NULL);
            } else {
                send_response(id_item, false, NULL, "Failed to preload next track");
            }
        }
        else if (strcmp(cmd, "play") == 0) {
            EnterCriticalSection(&g_cs_engine);
            if (!g_engine.current_track.is_valid) {
                LeaveCriticalSection(&g_cs_engine);
                send_response(id_item, false, NULL, "No track loaded");
                cJSON_Delete(root);
                continue;
            }
            g_engine.state = STATE_PLAYING;
            ma_device_start(&g_engine.ma_dev);
            double cur_pos = g_engine.current_position;
            LeaveCriticalSection(&g_cs_engine);

            cJSON* play_evt = cJSON_CreateObject();
            cJSON_AddNumberToObject(play_evt, "position", cur_pos);
            send_event("playing", play_evt);

            cJSON* res_data = cJSON_CreateObject();
            cJSON_AddBoolToObject(res_data, "playing", true);
            send_response(id_item, true, res_data, NULL);
        }
        else if (strcmp(cmd, "pause") == 0) {
            EnterCriticalSection(&g_cs_engine);
            g_engine.state = STATE_PAUSED;
            double cur_pos = g_engine.current_position;
            LeaveCriticalSection(&g_cs_engine);

            cJSON* pause_evt = cJSON_CreateObject();
            cJSON_AddNumberToObject(pause_evt, "position", cur_pos);
            send_event("paused", pause_evt);

            cJSON* res_data = cJSON_CreateObject();
            cJSON_AddBoolToObject(res_data, "paused", true);
            send_response(id_item, true, res_data, NULL);
        }
        else if (strcmp(cmd, "stop") == 0) {
            EnterCriticalSection(&g_cs_engine);
            g_engine.state = STATE_STOPPED;
            g_engine.played_frames = 0;
            g_engine.current_position = 0.0;
            ring_clear(&g_ring);
            LeaveCriticalSection(&g_cs_engine);

            cJSON* stop_evt = cJSON_CreateObject();
            send_event("stopped", stop_evt);

            cJSON* res_data = cJSON_CreateObject();
            cJSON_AddBoolToObject(res_data, "stopped", true);
            send_response(id_item, true, res_data, NULL);
        }
        else if (strcmp(cmd, "seek") == 0) {
            cJSON* pos_item = cJSON_GetObjectItem(root, "position");
            if (!pos_item || !cJSON_IsNumber(pos_item)) {
                send_response(id_item, false, NULL, "Missing position parameter");
                cJSON_Delete(root);
                continue;
            }

            double target = pos_item->valuedouble;
            EnterCriticalSection(&g_cs_engine);
            g_engine.seek_requested = true;
            g_engine.seek_target_seconds = target;
            g_engine.current_position = target;
            g_engine.buffer_primed = false;
            g_engine.deliberate_buffer_flushes++;
            g_engine.transition_pending = false;
            g_engine.track_transition_remaining_frames = 0;
            ring_clear(&g_ring);
            LeaveCriticalSection(&g_cs_engine);

            cJSON* res_data = cJSON_CreateObject();
            cJSON_AddNumberToObject(res_data, "position", target);
            send_response(id_item, true, res_data, NULL);
        }
        else if (strcmp(cmd, "setVolume") == 0) {
            cJSON* vol_item = cJSON_GetObjectItem(root, "volume");
            if (!vol_item || !cJSON_IsNumber(vol_item)) {
                send_response(id_item, false, NULL, "Missing or non-numeric volume parameter");
                cJSON_Delete(root);
                continue;
            }

            double vol = vol_item->valuedouble;
            /* Requirement 1: IPC must accept ONLY a normalized float from 0.0 to 1.0. Reject any other values. */
            if (isnan(vol) || vol < 0.0 || vol > 1.0) {
                send_response(id_item, false, NULL, "Volume must be a normalized float between 0.0 and 1.0");
                cJSON_Delete(root);
                continue;
            }

            float scaled_vol = (float)vol;
            EnterCriticalSection(&g_cs_engine);
            g_engine.volume = scaled_vol;
            LeaveCriticalSection(&g_cs_engine);

            send_event("audioPathChanged", build_audio_path_json());

            cJSON* res_data = cJSON_CreateObject();
            cJSON_AddNumberToObject(res_data, "volume", (double)scaled_vol);
            cJSON_AddBoolToObject(res_data, "softwareScaled", scaled_vol < 0.999f);
            send_response(id_item, true, res_data, NULL);
        }
        else if (strcmp(cmd, "setMute") == 0) {
            cJSON* mute_item = cJSON_GetObjectItem(root, "muted");
            bool m = mute_item ? cJSON_IsTrue(mute_item) : false;

            EnterCriticalSection(&g_cs_engine);
            g_engine.muted = m;
            LeaveCriticalSection(&g_cs_engine);

            send_event("audioPathChanged", build_audio_path_json());

            cJSON* res_data = cJSON_CreateObject();
            cJSON_AddBoolToObject(res_data, "muted", m);
            send_response(id_item, true, res_data, NULL);
        }
        else if (strcmp(cmd, "selectDevice") == 0) {
            cJSON* di = cJSON_GetObjectItem(root, "deviceId");
            const char* dev_id = (di && cJSON_IsString(di)) ? di->valuestring : NULL;

            bool ok = init_miniaudio_device(g_engine.output_mode, dev_id, g_engine.buffer_mode);
            if (ok && g_engine.state == STATE_PLAYING) {
                ma_device_start(&g_engine.ma_dev);
            }

            send_event("audioPathChanged", build_audio_path_json());

            cJSON* res_data = cJSON_CreateObject();
            cJSON_AddBoolToObject(res_data, "deviceChanged", ok);
            cJSON_AddStringToObject(res_data, "deviceName", g_engine.selected_device_name);
            send_response(id_item, ok, res_data, ok ? NULL : "Device selection failed");
        }
        else if (strcmp(cmd, "setOutputMode") == 0) {
            cJSON* om = cJSON_GetObjectItem(root, "outputMode");
            cJSON* sr = cJSON_GetObjectItem(root, "sampleRate");
            int mode = (om && cJSON_IsString(om) && strcmp(om->valuestring, "exclusive") == 0) ? 1 : 0;
            int req_sr = (sr && cJSON_IsNumber(sr)) ? sr->valueint : 0;

            EnterCriticalSection(&g_cs_engine);
            g_engine.buffer_primed = false;
            g_engine.deliberate_buffer_flushes++;
            if (req_sr > 0) {
                g_engine.telemetry.requested_sample_rate = req_sr;
            } else if (g_engine.current_track.is_valid && g_engine.current_track.sample_rate > 0) {
                g_engine.telemetry.requested_sample_rate = g_engine.current_track.sample_rate;
            }
            LeaveCriticalSection(&g_cs_engine);

            bool ok = init_miniaudio_device(mode, g_engine.selected_device_id, g_engine.buffer_mode);
            if (ok) {
                EnterCriticalSection(&g_cs_engine);
                if (g_engine.current_track.is_valid && g_engine.current_track.file_path[0]) {
                    track_context_open(&g_engine.current_track, g_engine.current_track.file_path, g_engine.actual_output_sample_rate, 2);
                }
                LeaveCriticalSection(&g_cs_engine);
                if (g_engine.state == STATE_PLAYING) {
                    ma_device_start(&g_engine.ma_dev);
                }
            }

            send_event("audioPathChanged", build_audio_path_json());

            cJSON* res_data = cJSON_CreateObject();
            cJSON_AddStringToObject(res_data, "outputMode", (g_engine.output_mode == 1) ? "exclusive" : "shared");
            cJSON_AddNumberToObject(res_data, "sampleRate", g_engine.actual_output_sample_rate);
            cJSON_AddBoolToObject(res_data, "exclusiveFallback", g_engine.exclusive_fallback);
            if (g_engine.exclusive_fallback) {
                cJSON_AddStringToObject(res_data, "fallbackReason", g_engine.exclusive_fallback_reason);
            }
            send_response(id_item, ok, res_data, ok ? NULL : "Output mode change failed");
        }
        else if (strcmp(cmd, "getAudioPath") == 0) {
            cJSON* path_json = build_audio_path_json();
            send_response(id_item, true, path_json, NULL);
        }
        else if (strcmp(cmd, "dumpDecodedPcm") == 0) {
            cJSON* fp = cJSON_GetObjectItem(root, "filePath");
            cJSON* op = cJSON_GetObjectItem(root, "outputPath");
            cJSON* sr = cJSON_GetObjectItem(root, "sampleRate");
            int target_sr = (sr && cJSON_IsNumber(sr)) ? sr->valueint : 0;
            if (!fp || !op || !cJSON_IsString(fp) || !cJSON_IsString(op)) {
                send_response(id_item, false, NULL, "Missing filePath or outputPath");
                cJSON_Delete(root);
                continue;
            }
            int res = run_offline_dump(fp->valuestring, op->valuestring, target_sr);
            if (res == 0) {
                cJSON* res_data = cJSON_CreateObject();
                cJSON_AddBoolToObject(res_data, "dumped", true);
                send_response(id_item, true, res_data, NULL);
            } else {
                send_response(id_item, false, NULL, "Offline dump failed");
            }
        }
        else if (strcmp(cmd, "shutdown") == 0) {
            send_response(id_item, true, NULL, NULL);
            cJSON_Delete(root);
            break;
        }
        else {
            send_response(id_item, false, NULL, "Unknown command");
        }

        cJSON_Delete(root);
    }

    /* Clean Shutdown and Instant Orphan Prevention */
    g_engine.running = false;
    if (g_engine.ma_dev_initialized) {
        ma_device_stop(&g_engine.ma_dev);
        ma_device_uninit(&g_engine.ma_dev);
    }
    if (g_engine.ma_ctx_initialized) {
        ma_context_uninit(&g_engine.ma_ctx);
    }

    track_context_free(&g_engine.current_track);
    track_context_free(&g_engine.next_track);
    free(g_ring.data);

    DeleteCriticalSection(&g_cs_stdout);
    DeleteCriticalSection(&g_cs_engine);
    DeleteCriticalSection(&g_cs_ring);

    ExitProcess(0);
    return 0;
}
