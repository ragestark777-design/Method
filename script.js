// script.js — Полный рефакторинг (исправление ошибки fetchFile)
document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // ============ КОНСТАНТЫ И НАСТРОЙКИ ============
    const MAX_FILE_SIZE_MB = 500;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/mov'];
    const OUTPUT_FILENAME = 'tiktok_vq_ultra.mp4';

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

    // ============ СОСТОЯНИЕ ПРИЛОЖЕНИЯ ============
    let currentFile = null;
    let isProcessing = false;
    let resultBlobUrl = null;
    let ffmpegInstance = null;

    // ============ ЧТЕНИЕ ФАЙЛА В Uint8Array (замена fetchFile) ============
    function readFileAsUint8Array(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result));
            reader.onerror = () => reject(new Error('Ошибка чтения файла'));
            reader.readAsArrayBuffer(file);
        });
    }

    // ============ ИНИЦИАЛИЗАЦИЯ FFmpeg (ленивая) ============
    async function getFFmpeg() {
        if (ffmpegInstance && ffmpegInstance.isLoaded()) {
            return ffmpegInstance;
        }

        // Проверяем наличие глобального FFmpeg
        if (typeof FFmpeg === 'undefined' || typeof FFmpeg.createFFmpeg !== 'function') {
            throw new Error('FFmpeg не загружен. Обновите страницу.');
        }

        const { createFFmpeg } = FFmpeg; // fetchFile не используем

        ffmpegInstance = createFFmpeg({
            log: false,
            mainName: 'main',
            corePath: 'https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js',
        });

        ffmpegInstance.setProgress(({ ratio }) => {
            if (ratio >= 0 && ratio <= 1 && elements.progressBar) {
                const percent = Math.round(ratio * 100);
                elements.progressBar.style.width = `${percent}%`;
                elements.progressBar.setAttribute('aria-valuenow', percent);
            }
        });

        await ffmpegInstance.load();
        return ffmpegInstance;
    }

    // ============ УПРАВЛЕНИЕ ПАМЯТЬЮ ============
    function revokeResultBlobUrl() {
        if (resultBlobUrl) {
            URL.revokeObjectURL(resultBlobUrl);
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
        } catch (e) {
            // Файл мог уже не существовать — игнорируем
        }
    }

    // ============ ВАЛИДАЦИЯ ФАЙЛА ============
    function validateFile(file) {
        if (!file) {
            return { valid: false, error: 'Файл не выбран.' };
        }

        const isVideo = file.type.startsWith('video/') ||
                        ALLOWED_TYPES.includes(file.type) ||
                        /\.(mp4|mov|m4v)$/i.test(file.name);
        if (!isVideo) {
            return {
                valid: false,
                error: 'Неподдерживаемый формат. Пожалуйста, выберите видеофайл (MP4, MOV).',
            };
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            return {
                valid: false,
                error: `Файл слишком большой (${(file.size / 1024 / 1024).toFixed(1)} МБ). Максимальный размер: ${MAX_FILE_SIZE_MB} МБ.`,
            };
        }

        if (file.size === 0) {
            return { valid: false, error: 'Файл пуст. Выберите другой.' };
        }

        return { valid: true, error: null };
    }

    // ============ ОТОБРАЖЕНИЕ ОШИБОК ============
    function showError(message) {
        if (elements.errorMessage) {
            elements.errorMessage.textContent = message;
            elements.errorMessage.style.display = 'block';
        }
        clearTimeout(window._errorTimeout);
        window._errorTimeout = setTimeout(() => {
            if (elements.errorMessage) {
                elements.errorMessage.style.display = 'none';
            }
        }, 6000);
    }

    function hideError() {
        if (elements.errorMessage) {
            elements.errorMessage.style.display = 'none';
        }
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
            updateStatus('Загрузка ядра FFmpeg...', 5);
            ffmpeg = await getFFmpeg();

            // Чтение файла в Uint8Array (собственная реализация, не fetchFile)
            updateStatus('Чтение исходного видео...', 10);
            const fileData = await readFileAsUint8Array(currentFile);
            ffmpeg.FS('writeFile', inputName, fileData);

            updateStatus('Применение HQ-фильтров (VQ 70+, 1080p60)...', 15);

            const filterChain = [
                'fps=60',
                'tblend=all_mode=average',
                'scale=1080:-2:flags=lanczos',
                'eq=contrast=1.05:saturation=1.08',
                'unsharp=5:5:1.2:5:5:0.5',
            ].join(',');

            await ffmpeg.run(
                '-i', inputName,
                '-r', '60',
                '-vf', filterChain,
                '-c:v', 'libx264',
                '-profile:v', 'high',
                '-level:v', '4.2',
                '-crf', '16',
                '-maxrate', '25M',
                '-bufsize', '30M',
                '-preset', 'ultrafast',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac',
                '-b:a', '256k',
                '-movflags', '+faststart',
                outputName
            );

            updateStatus('Чтение результата...', 95);

            const data = ffmpeg.FS('readFile', outputName);
            const blob = new Blob([data.buffer], { type: 'video/mp4' });

            revokeResultBlobUrl();
            resultBlobUrl = URL.createObjectURL(blob);

            updateStatus('Готово!', 100);

            if (elements.videoPlayer) elements.videoPlayer.src = resultBlobUrl;
            if (elements.downloadLink) elements.downloadLink.href = resultBlobUrl;

            if (elements.statusContainer) elements.statusContainer.style.display = 'none';
            if (elements.resultContainer) elements.resultContainer.style.display = 'flex';

            safeUnlinkFS(ffmpeg, inputName);
            safeUnlinkFS(ffmpeg, outputName);

        } catch (error) {
            console.error('Ошибка обработки видео:', error);

            if (ffmpeg && ffmpeg.isLoaded()) {
                safeUnlinkFS(ffmpeg, inputName);
                safeUnlinkFS(ffmpeg, outputName);
            }

            let userMessage = 'Произошла ошибка при обработке видео.';
            if (error.message) {
                if (error.message.includes('Out of memory') || error.message.includes('memory')) {
                    userMessage = 'Недостаточно памяти. Попробуйте видео меньшего размера или закройте другие вкладки.';
                } else if (error.message.includes('format') || error.message.includes('codec')) {
                    userMessage = 'Неподдерживаемый формат видео. Попробуйте конвертировать в MP4 перед загрузкой.';
                } else {
                    userMessage = `Ошибка: ${error.message}`;
                }
            }

            showError(userMessage);
            if (elements.statusContainer) elements.statusContainer.style.display = 'none';
            if (elements.spinner) elements.spinner.style.display = 'none';
            if (elements.processBtn) elements.processBtn.disabled = false;

        } finally {
            isProcessing = false;
            window.removeEventListener('beforeunload', beforeUnloadHandler);
        }
    }

    // ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
    function updateStatus(text, percent = null) {
        if (elements.statusText) elements.statusText.textContent = text;
        if (percent !== null && elements.progressBar) {
            elements.progressBar.style.width = `${percent}%`;
            elements.progressBar.setAttribute('aria-valuenow', percent);
        }
    }

    function beforeUnloadHandler(e) {
        if (isProcessing) {
            e.preventDefault();
            e.returnValue = 'Идёт обработка видео. Если вы закроете вкладку, прогресс будет потерян.';
            return e.returnValue;
        }
    }

    // ============ ПРИВЯЗКА СОБЫТИЙ ============
    if (elements.videoInput) {
        elements.videoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleFileSelect(file);
        });
    }

    if (elements.uploadZone) {
        elements.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            elements.uploadZone.style.borderColor = '#fe2c55';
        });
        elements.uploadZone.addEventListener('dragleave', () => {
            elements.uploadZone.style.borderColor = '#33374a';
            if (currentFile) elements.uploadZone.style.borderColor = 'var(--accent-color)';
        });
        elements.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            elements.uploadZone.style.borderColor = '#33374a';
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
        elements.processBtn.addEventListener('click', () => {
            if (!isProcessing && currentFile) processVideo();
        });
    }

    if (elements.newFileBtn) {
        elements.newFileBtn.addEventListener('click', () => {
            resetUI(false);
            if (elements.uploadZone) elements.uploadZone.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    if (elements.downloadLink) {
        elements.downloadLink.addEventListener('click', (e) => {
            if (!resultBlobUrl) {
                e.preventDefault();
                showError('Видео ещё не обработано.');
            }
        });
    }

    // Инициализация
    resetUI(false);

    console.log('✅ TikTok Ultra HQ Optimizer инициализирован.');
    console.log('   Поддерживаемые форматы: MP4, MOV');
    console.log('   Макс. размер файла:', MAX_FILE_SIZE_MB, 'МБ');
    console.log('   Целевые параметры: 1080p, 60 FPS, CRF 16, High Profile');
});
