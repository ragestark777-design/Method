// script.js — Полная версия с резервными CDN, таймаутами и защитой от зависаний
document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // ============ КОНСТАНТЫ ============
    const MAX_FILE_SIZE_MB = 500;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/mov'];
    const OUTPUT_FILENAME = 'tiktok_vq_ultra.mp4';
    const FFMPEG_LOAD_TIMEOUT_MS = 20000; // 20 секунд на загрузку ядра

    // Резервные CDN для однопоточного ядра
    const CORE_PATHS = [
        'https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js',
        'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js'
    ];

    // ============ DOM-ЭЛЕМЕНТЫ ============
    const elements = {
        uploadZone: document.getElementById('upload-zone'),
        videoInput: document.getElementById('video-input'),
        fileName: document.getElementById('file-name'),
        uploadDesc: document.getElementById('upload-desc'),
        processBtn: document.getElementById('process-btn'),
        statusContainer: document.getElementById('status-container'),
        progressBar: document.getElementById('progress-bar'),
        spinner: document.getElementById('spinner'),
        statusText: document.getElementById('status-text'),
        resultContainer: document.getElementById('result-container'),
        videoPlayer: document.getElementById('video-player'),
        downloadLink: document.getElementById('download-link'),
        newFileBtn: document.getElementById('new-file-btn'),
        errorMessage: document.getElementById('error-message'),
    };

    // ============ СОСТОЯНИЕ ============
    let currentFile = null;
    let isProcessing = false;
    let resultBlobUrl = null;
    let ffmpegInstance = null;
    let corePathIndex = 0; // индекс рабочего CDN

    // ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
    function log(msg, type = 'info') {
        const time = new Date().toISOString().slice(11, 19);
        if (type === 'error') console.error(`[${time}] ❌ ${msg}`);
        else if (type === 'warn') console.warn(`[${time}] ⚠️ ${msg}`);
        else console.log(`[${time}] ℹ️ ${msg}`);
    }

    function withTimeout(promise, ms, errorMsg) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
        ]);
    }

    function updateStatus(text, percent = null) {
        if (elements.statusText) elements.statusText.textContent = text;
        if (percent !== null && elements.progressBar) {
            elements.progressBar.style.width = `${percent}%`;
            elements.progressBar.setAttribute('aria-valuenow', percent);
        }
        log(text);
    }

    function readFileAsUint8Array(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result));
            reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
            reader.onabort = () => reject(new Error('Чтение отменено'));
            reader.readAsArrayBuffer(file);
        });
    }

    // ============ УПРАВЛЕНИЕ ПАМЯТЬЮ ============
    function revokeResultBlobUrl() {
        if (resultBlobUrl) {
            URL.revokeObjectURL(resultBlobUrl);
            log('Предыдущий Blob URL освобождён');
            resultBlobUrl = null;
        }
    }

    function cleanupVideoPlayer() {
        if (elements.videoPlayer) {
            elements.videoPlayer.pause();
            elements.videoPlayer.removeAttribute('src');
            elements.videoPlayer.load();
        }
    }

    function safeUnlinkFS(ffmpeg, filename) {
        try {
            ffmpeg.FS('unlink', filename);
            log(`Файл ${filename} удалён из виртуальной ФС`);
        } catch (e) {
            // Игнорируем, если файл уже удалён
        }
    }

    // ============ ИНИЦИАЛИЗАЦИЯ FFMPEG С РЕЗЕРВНЫМИ CDN ============
    async function getFFmpeg() {
        if (ffmpegInstance && ffmpegInstance.isLoaded()) return ffmpegInstance;

        if (typeof FFmpeg === 'undefined' || typeof FFmpeg.createFFmpeg !== 'function') {
            throw new Error('FFmpeg не загружен. Обновите страницу.');
        }

        for (let i = corePathIndex; i < CORE_PATHS.length; i++) {
            try {
                const corePath = CORE_PATHS[i];
                log(`Попытка загрузить ядро с ${corePath}`);

                ffmpegInstance = FFmpeg.createFFmpeg({
                    log: false,
                    mainName: 'main',
                    corePath: corePath,
                    worker: false, // без воркеров для совместимости с iOS
                });

                ffmpegInstance.setProgress(({ ratio }) => {
                    if (ratio >= 0 && ratio <= 1 && elements.progressBar) {
                        const pct = Math.round(ratio * 100);
                        elements.progressBar.style.width = `${pct}%`;
                        elements.progressBar.setAttribute('aria-valuenow', pct);
                    }
                });

                await withTimeout(ffmpegInstance.load(), FFMPEG_LOAD_TIMEOUT_MS,
                    'Таймаут загрузки ядра FFmpeg');
                log('Ядро FFmpeg загружено успешно');
                corePathIndex = i; // запоминаем рабочий CDN
                return ffmpegInstance;
            } catch (err) {
                log(`CDN ${CORE_PATHS[i]} не сработал: ${err.message}`, 'warn');
                ffmpegInstance = null;
                if (i === CORE_PATHS.length - 1) {
                    throw new Error('Не удалось загрузить ядро FFmpeg с доступных CDN. Проверьте интернет.');
                }
            }
        }
    }

    // ============ ВАЛИДАЦИЯ ФАЙЛА ============
    function validateFile(file) {
        if (!file) return { valid: false, error: 'Файл не выбран.' };

        const isVideo = file.type.startsWith('video/') ||
                        ALLOWED_TYPES.includes(file.type) ||
                        /\.(mp4|mov|m4v)$/i.test(file.name);
        if (!isVideo) {
            return { valid: false, error: 'Неподдерживаемый формат. Выберите MP4 или MOV.' };
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            return {
                valid: false,
                error: `Файл слишком большой (${(file.size / 1024 / 1024).toFixed(1)} МБ). Максимум: ${MAX_FILE_SIZE_MB} МБ.`
            };
        }

        if (file.size === 0) {
            return { valid: false, error: 'Файл пуст.' };
        }

        return { valid: true, error: null };
    }

    // ============ ОТОБРАЖЕНИЕ ОШИБОК ============
    function showError(message) {
        if (elements.errorMessage) {
            elements.errorMessage.textContent = message;
            elements.errorMessage.style.display = 'block';
        }
        log(`Ошибка UI: ${message}`, 'error');
        clearTimeout(window._errorTimeout);
        window._errorTimeout = setTimeout(() => {
            if (elements.errorMessage) elements.errorMessage.style.display = 'none';
        }, 8000);
    }

    function hideError() {
        if (elements.errorMessage) elements.errorMessage.style.display = 'none';
        clearTimeout(window._errorTimeout);
    }

    // ============ СБРОС ИНТЕРФЕЙСА ============
    function resetUI(keepFile = false) {
        hideError();
        revokeResultBlobUrl();
        cleanupVideoPlayer();

        if (elements.statusContainer) elements.statusContainer.style.display = 'none';
        if (elements.resultContainer) elements.resultContainer.style.display = 'none';
        if (elements.progressBar) {
            elements.progressBar.style.width = '0%';
            elements.progressBar.setAttribute('aria-valuenow', 0);
        }
        if (elements.spinner) elements.spinner.style.display = 'block';

        if (!keepFile) {
            currentFile = null;
            if (elements.videoInput) elements.videoInput.value = '';
            if (elements.fileName) elements.fileName.textContent = 'Выбрать видеофайл';
            if (elements.uploadDesc) elements.uploadDesc.textContent = 'MP4, MOV · до 500 МБ';
            if (elements.uploadZone) elements.uploadZone.classList.remove('file-selected');
            if (elements.processBtn) elements.processBtn.disabled = true;
        }
        log('Интерфейс сброшен');
    }

    // ============ ОБРАБОТКА ВЫБОРА ФАЙЛА ============
    function handleFileSelect(file) {
        hideError();
        revokeResultBlobUrl();
        cleanupVideoPlayer();
        if (elements.resultContainer) elements.resultContainer.style.display = 'none';
        if (elements.statusContainer) elements.statusContainer.style.display = 'none';

        const validation = validateFile(file);
        if (!validation.valid) {
            showError(validation.error);
            if (elements.processBtn) elements.processBtn.disabled = true;
            if (elements.fileName) elements.fileName.textContent = 'Выбрать видеофайл';
            if (elements.uploadZone) elements.uploadZone.classList.remove('file-selected');
            currentFile = null;
            return;
        }

        currentFile = file;
        if (elements.fileName) elements.fileName.textContent = file.name;
        if (elements.uploadDesc) {
            const sizeMB = (file.size / 1024 / 1024).toFixed(1);
            elements.uploadDesc.textContent = `${sizeMB} МБ · ${file.type || 'video'}`;
        }
        if (elements.uploadZone) elements.uploadZone.classList.add('file-selected');
        if (elements.processBtn) elements.processBtn.disabled = false;
        log(`Выбран файл: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} МБ)`);
    }

    // ============ ОБРАБОТКА ВИДЕО ============
    async function processVideo() {
        if (!currentFile || isProcessing) return;

        isProcessing = true;
        hideError();

        if (elements.statusContainer) elements.statusContainer.style.display = 'flex';
        if (elements.resultContainer) elements.resultContainer.style.display = 'none';
        if (elements.progressBar) {
            elements.progressBar.style.width = '0%';
            elements.progressBar.setAttribute('aria-valuenow', 0);
        }
        if (elements.spinner) elements.spinner.style.display = 'block';
        if (elements.processBtn) elements.processBtn.disabled = true;

        window.addEventListener('beforeunload', beforeUnloadHandler);

        let ffmpeg = null;
        const inputName = 'input.mp4';
        const outputName = OUTPUT_FILENAME;

        try {
            // Этап 1: Загрузка FFmpeg
            updateStatus('Загрузка FFmpeg...', 5);
            ffmpeg = await getFFmpeg();

            // Этап 2: Чтение файла
            updateStatus('Чтение файла...', 10);
            const fileData = await withTimeout(
                readFileAsUint8Array(currentFile),
                30000,
                'Чтение файла зависло. Возможно, файл повреждён.'
            );
            ffmpeg.FS('writeFile', inputName, fileData);
            log('Файл загружен в виртуальную ФС');

            // Этап 3: Перекодирование (облегчённые параметры для стабильности)
            updateStatus('Обработка (720p, CRF 20)...', 15);

            const filterChain = [
                'fps=60',
                'scale=720:-2:flags=lanczos',
                'eq=contrast=1.03:saturation=1.05',
                'unsharp=3:3:1.0:3:3:0.5'
            ].join(',');

            await withTimeout(
                ffmpeg.run(
                    '-i', inputName,
                    '-r', '60',
                    '-vf', filterChain,
                    '-c:v', 'libx264',
                    '-profile:v', 'high',
                    '-crf', '20',
                    '-maxrate', '15M',
                    '-bufsize', '20M',
                    '-preset', 'ultrafast',
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-movflags', '+faststart',
                    outputName
                ),
                180000, // 3 минуты макс
                'Обработка заняла слишком много времени.'
            );

            updateStatus('Сборка результата...', 95);
            const data = ffmpeg.FS('readFile', outputName);
            const blob = new Blob([data.buffer], { type: 'video/mp4' });

            revokeResultBlobUrl();
            resultBlobUrl = URL.createObjectURL(blob);

            if (elements.videoPlayer) elements.videoPlayer.src = resultBlobUrl;
            if (elements.downloadLink) elements.downloadLink.href = resultBlobUrl;

            updateStatus('Готово!', 100);
            if (elements.statusContainer) elements.statusContainer.style.display = 'none';
            if (elements.resultContainer) elements.resultContainer.style.display = 'flex';

            safeUnlinkFS(ffmpeg, inputName);
            safeUnlinkFS(ffmpeg, outputName);

        } catch (error) {
            log(`Ошибка: ${error.message}`, 'error');
            console.error(error);

            if (ffmpeg && ffmpeg.isLoaded()) {
                safeUnlinkFS(ffmpeg, inputName);
                safeUnlinkFS(ffmpeg, outputName);
            }

            let userMessage = 'Произошла ошибка обработки.';
            if (error.message.includes('Не удалось загрузить ядро')) {
                userMessage = 'Не удалось загрузить FFmpeg. Проверьте интернет-соединение.';
            } else if (error.message.includes('памят')) {
                userMessage = 'Недостаточно памяти. Закройте другие вкладки или используйте файл меньшего размера.';
            } else if (error.message.includes('формат') || error.message.includes('codec')) {
                userMessage = 'Неподдерживаемый формат. Конвертируйте видео в MP4 (H.264) перед загрузкой.';
            } else if (error.message.includes('времени')) {
                userMessage = error.message;
            } else {
                userMessage = `Ошибка: ${error.message}`;
            }

            showError(userMessage);
            if (elements.statusContainer) elements.statusContainer.style.display = 'none';
            if (elements.spinner) elements.spinner.style.display = 'none';
            if (elements.processBtn) elements.processBtn.disabled = false;

        } finally {
            isProcessing = false;
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            if (elements.spinner) elements.spinner.style.display = 'none';
            if (elements.processBtn) elements.processBtn.disabled = false;
        }
    }

    // ============ ОБРАБОТЧИК ЗАКРЫТИЯ ВКЛАДКИ ============
    function beforeUnloadHandler(e) {
        if (isProcessing) {
            e.preventDefault();
            e.returnValue = 'Идёт обработка видео. При закрытии прогресс будет потерян.';
            return e.returnValue;
        }
    }

    // ============ ПРИВЯЗКА СОБЫТИЙ ============
    if (elements.videoInput) {
        elements.videoInput.addEventListener('change', (e) => {
            handleFileSelect(e.target.files[0]);
        });
    }

    if (elements.uploadZone) {
        elements.uploadZone.addEventListener('dragover', (e) => e.preventDefault());
        elements.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) {
                const dt = new DataTransfer();
                dt.items.add(file);
                elements.videoInput.files = dt.files;
                handleFileSelect(file);
            }
        });
    }

    if (elements.processBtn) {
        elements.processBtn.addEventListener('click', processVideo);
    }

    if (elements.newFileBtn) {
        elements.newFileBtn.addEventListener('click', () => {
            resetUI(false);
            elements.uploadZone?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    if (elements.downloadLink) {
        elements.downloadLink.addEventListener('click', (e) => {
            if (!resultBlobUrl) {
                e.preventDefault();
                showError('Нет обработанного видео.');
            }
        });
    }

    // ============ СТАРТОВАЯ ИНИЦИАЛИЗАЦИЯ ============
    resetUI(false);
    log('Приложение TikTok Ultra HQ Optimizer готово (v9)');
});
