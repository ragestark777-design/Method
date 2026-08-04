const { createFFmpeg, fetchFile } = FFmpeg;

// Однопоточное ядро (core-st), которому НЕ нужен SharedArrayBuffer (идеально для Safari/iOS)
const ffmpeg = createFFmpeg({
    log: true,
    mainName: 'main',
    corePath: 'https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js'
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
        status.innerText = 'Загрузка однопоточного ядра FFmpeg...';

        if (!ffmpeg.isLoaded()) {
            await ffmpeg.load();
        }

        status.innerText = 'Загрузка файла в память...';
        const inputName = 'input.mp4';
        const outputName = 'output.mp4';

        ffmpeg.FS('writeFile', inputName, await fetchFile(file));

        status.innerText = 'Идет обработка видео (не закрывай вкладку)...';

        await ffmpeg.run(
            '-i', inputName,
            '-vf', 'tblend=all_mode=average,framestep=2,scale=1080:1920:flags=lanczos,unsharp=5:5:1.0:5:5:0.0',
            '-c:v', 'libx264',
            '-crf', '18',
            '-preset', 'ultrafast',
            '-pix_fmt', 'yuv420p',
            outputName
        );

        status.innerText = 'Готово! Видео обработано.';

        const data = ffmpeg.FS('readFile', outputName);
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));

        downloadLink.href = url;
        downloadLink.style.display = 'inline-block';
        downloadLink.innerText = '⬇ Скачать готовое видео';

        ffmpeg.FS('unlink', inputName);
        ffmpeg.FS('unlink', outputName);

    } catch (error) {
        console.error("Ошибка:", error);
        status.innerHTML = `<span style="color: #ff4444;">Ошибка: ${error.message || 'Сбой ядра'}</span>`;
    } finally {
        processBtn.disabled = false;
    }
});
