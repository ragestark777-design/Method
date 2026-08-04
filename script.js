const { createFFmpeg, fetchFile } = FFmpeg;

// Отключаем лишние потоки для стабильности на мобильных устройствах
const ffmpeg = createFFmpeg({ 
    log: true,
    mainName: 'main'
});

const processBtn = document.getElementById('process-btn');
const status = document.getElementById('status');
const videoInput = document.getElementById('video-input');
const downloadLink = document.getElementById('download-link');

processBtn.addEventListener('click', async () => {
    const file = videoInput.files[0];
    
    if (!file) {
        alert('Выбери видеофайл!');
        return;
    }

    try {
        processBtn.disabled = true;
        downloadLink.style.display = 'none';
        
        // Проверка поддержки памяти браузером
        if (!window.SharedArrayBuffer) {
            status.innerHTML = '<span style="color: #ff4444;">⚠️ Браузер еще не обновил заголовки безопасности. Пожалуйста, ОБНОВИ СТРАНИЦУ еще раз!</span>';
            processBtn.disabled = false;
            return;
        }

        status.innerText = 'Загрузка ядра FFmpeg...';

        if (!ffmpeg.isLoaded()) {
            await ffmpeg.load();
        }

        status.innerText = 'Подготовка видео файла...';
        const inputName = 'input.mp4';
        const outputName = 'output.mp4';

        ffmpeg.FS('writeFile', inputName, await fetchFile(file));

        status.innerText = 'Обработка (Motion Blur + Scale + Sharp)...';

        await ffmpeg.run(
            '-i', inputName,
            '-vf', 'tblend=all_mode=average,framestep=2,scale=1080:1920:flags=lanczos,unsharp=5:5:1.0:5:5:0.0',
            '-c:v', 'libx264',
            '-crf', '18',
            '-preset', 'ultrafast',
            '-pix_fmt', 'yuv420p',
            outputName
        );

        status.innerText = 'Готово! Файл успешно обработан.';

        const data = ffmpeg.FS('readFile', outputName);
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));

        downloadLink.href = url;
        downloadLink.style.display = 'inline-block';
        downloadLink.innerText = '⬇ Скачать готовое видео';

        ffmpeg.FS('unlink', inputName);
        ffmpeg.FS('unlink', outputName);

    } catch (error) {
        console.error("Ошибка FFmpeg:", error);
        status.innerHTML = `<span style="color: #ff4444;">Ошибка: ${error.message || 'Нехватка памяти или сбой ядра'}</span>`;
    } finally {
        processBtn.disabled = false;
    }
});
