const { createFFmpeg, fetchFile } = FFmpeg;

// Явно задаем пути к ядру, WASM и Worker с одного надежного CDN
const ffmpeg = createFFmpeg({
    log: true,
    corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
    wasmPath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.wasm',
    workerPath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.worker.js'
});

const processBtn = document.getElementById('process-btn');
const status = document.getElementById('status');
const videoInput = document.getElementById('video-input');
const downloadLink = document.getElementById('download-link');

processBtn.addEventListener('click', async () => {
    const file = videoInput.files[0];
    
    if (!file) {
        alert('Пожалуйста, выбери видеофайл!');
        return;
    }

    try {
        processBtn.disabled = true;
        downloadLink.style.display = 'none';
        status.innerText = 'Загрузка компонентов FFmpeg (10-15 сек)...';

        // Загружаем ядро
        if (!ffmpeg.isLoaded()) {
            await ffmpeg.load();
        }

        status.innerText = 'Загрузка файла в память...';
        const inputName = 'input.mp4';
        const outputName = 'output.mp4';

        ffmpeg.FS('writeFile', inputName, await fetchFile(file));

        status.innerText = 'Обработка видео... (Не закрывай вкладку)';

        // Команда сжатия и обработки
        await ffmpeg.run(
            '-i', inputName,
            '-vf', 'tblend=all_mode=average,framestep=2,scale=1080:1920:flags=lanczos,unsharp=5:5:1.0:5:5:0.0',
            '-c:v', 'libx264',
            '-crf', '18',
            '-preset', 'ultrafast',
            '-pix_fmt', 'yuv420p',
            outputName
        );

        status.innerText = 'Готово! Видео успешно обработано.';

        const data = ffmpeg.FS('readFile', outputName);
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));

        downloadLink.href = url;
        downloadLink.style.display = 'inline-block';
        downloadLink.innerText = '⬇ Скачать готовое видео';

        ffmpeg.FS('unlink', inputName);
        ffmpeg.FS('unlink', outputName);

    } catch (error) {
        console.error("Ошибка:", error);
        status.innerHTML = `<span style="color: #ff4444;">Ошибка: ${error.message || 'Сбой при загрузке ядра'}</span>`;
    } finally {
        processBtn.disabled = false;
    }
});
