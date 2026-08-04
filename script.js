const { createFFmpeg, fetchFile } = FFmpeg;

// Создаем экземпляр FFmpeg
const ffmpeg = createFFmpeg({ log: true });

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
        status.innerText = 'Загрузка ядра FFmpeg в браузер...';

        // Загружаем ядро, если оно ещё не инициализировано
        if (!ffmpeg.isLoaded()) {
            await ffmpeg.load();
        }

        status.innerText = 'Чтение файла...';
        const inputName = 'input_' + Date.now() + '.mp4';
        const outputName = 'output_' + Date.now() + '.mp4';

        // Записываем файл в виртуальную память FFmpeg
        ffmpeg.FS('writeFile', inputName, await fetchFile(file));

        status.innerText = 'Обработка видео... (Это может занять некоторое время)';

        // Выполняем патч-команду
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

        // Считываем обработанный файл из виртуальной памяти
        const data = ffmpeg.FS('readFile', outputName);
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));

        // Настраиваем ссылку для скачивания
        downloadLink.href = url;
        downloadLink.style.display = 'inline-block';
        downloadLink.innerText = '⬇ Скачать оптимизированный файл';

        // Очищаем память от обработанных файлов
        ffmpeg.FS('unlink', inputName);
        ffmpeg.FS('unlink', outputName);

    } catch (error) {
        console.error(error);
        status.innerText = 'Ошибка обработки! Проверь консоль браузера.';
    } finally {
        processBtn.disabled = false;
    }
});
