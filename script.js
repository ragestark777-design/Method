const { FFmpeg } = FFmpegJS;
const { fetchFile } = FFmpegUtil;

const ffmpeg = new FFmpeg();

const processBtn = document.getElementById('process-btn');
const status = document.getElementById('status');
const videoInput = document.getElementById('video-input');
const downloadLink = document.getElementById('download-link');

processBtn.addEventListener('click', async () => {
    const file = videoInput.files[0];
    if (!file) {
        alert('Пожалуйста, выбери видео!');
        return;
    }

    status.innerText = 'Загрузка движка FFmpeg...';
    
    // Загружаем ядро FFmpeg в браузер
    if (!ffmpeg.loaded) {
        await ffmpeg.load();
    }

    status.innerText = 'Обработка видео (это может занять некоторое время)...';

    // Записываем входящий файл в виртуальную память FFmpeg
    await ffmpeg.writeFile('input.mp4', await fetchFile(file));

    // Выполняем команду сглаживания 120->60 FPS, ресайза и повышения резкости
    await ffmpeg.exec([
        '-i', 'input.mp4',
        '-vf', 'tblend=all_mode=average,framestep=2,scale=1080:1920:flags=lanczos,unsharp=5:5:1.0:5:5:0.0',
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'ultrafast', // Для браузеров используем ultrafast для ускорения
        '-pix_fmt', 'yuv420p',
        'output.mp4'
    ]);

    status.innerText = 'Обработка завершена!';

    // Считываем результат и создаем ссылку на скачивание
    const data = await ffmpeg.readFile('output.mp4');
    const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
    
    downloadLink.href = url;
    downloadLink.style.display = 'inline-block';
    downloadLink.innerText = '⬇ Скачать оптимизированный файл';
});