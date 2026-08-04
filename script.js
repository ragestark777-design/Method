const { createFFmpeg, fetchFile } = FFmpeg;

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
        status.innerText = 'Загрузка ядра FFmpeg...';

        if (!ffmpeg.isLoaded()) {
            await ffmpeg.load();
        }

        status.innerText = 'Чтение исходника...';
        const inputName = 'input.mp4';
        const outputName = 'tiktok_vq_ultra.mp4';

        ffmpeg.FS('writeFile', inputName, await fetchFile(file));

        status.innerText = 'Применение HQ-фильтров (VQ Score 70+ / 1080p60)...';

        // Цепочка фильтров для идеального VQ Score в TikTok:
        // 1. tblend + framestep = плавная интерполяция / motion blur при сжатии 120fps -> 60fps
        // 2. scale = четкий Lanczos в 1080x1080 (или 1080x1920)
        // 3. eq = легкое усиление контраста (1.05) и насыщенности (1.1)
        // 4. unsharp = многопроходная резкость для подчёркивания деталей
        const filterChain = [
            'tblend=all_mode=average,framestep=2',
            'scale=1080:1080:flags=lanczos',
            'eq=contrast=1.05:saturation=1.08',
            'unsharp=5:5:1.2:5:5:0.5'
        ].join(',');

        await ffmpeg.run(
            '-i', inputName,
            '-r', '60',
            '-vf', filterChain,
            '-c:v', 'libx264',
            '-profile:v', 'high',
            '-level:v', '4.2',
            '-crf', '16',                  // Минимальное сжатие для максимальной чёткости
            '-maxrate', '25M',
            '-bufsize', '30M',
            '-preset', 'ultrafast',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '256k',
            outputName
        );

        status.innerText = '🎉 Видео готово! Максимальное качество сгенерировано.';

        const data = ffmpeg.FS('readFile', outputName);
        const blob = new Blob([data.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);

        downloadLink.href = url;
        downloadLink.style.display = 'inline-block';
        downloadLink.innerText = '⬇ Скачать VQ Ultra 1080p60';

        downloadLink.onclick = () => {
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            if (isIOS) {
                window.open(url, '_blank');
            }
        };

        ffmpeg.FS('unlink', inputName);
        ffmpeg.FS('unlink', outputName);

    } catch (error) {
        console.error("Ошибка:", error);
        status.innerHTML = `<span style="color: #ff4444;">Ошибка: ${error.message || 'Сбой обработки'}</span>`;
    } finally {
        processBtn.disabled = false;
    }
});
