using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Windows.Media.Editing;
using Windows.Media.MediaProperties;
using Windows.Media.Transcoding;
using Windows.Storage;

internal static class MediaCompositionRenderer
{
    private static void Log(string message)
    {
        Console.WriteLine(message);
    }

    private static async Task<int> RenderAsync(string framesDirectory, string narrationPath, string outputPath, int fps)
    {
        var frames = Directory.GetFiles(framesDirectory, "*.jpg")
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (frames.Length == 0)
        {
            Console.Error.WriteLine("No JPEG frames were found.");
            return 2;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
        if (!File.Exists(outputPath))
        {
            File.WriteAllBytes(outputPath, new byte[0]);
        }

        var composition = new MediaComposition();
        var frameDuration = TimeSpan.FromSeconds(1.0 / fps);
        foreach (var framePath in frames)
        {
            var file = await StorageFile.GetFileFromPathAsync(Path.GetFullPath(framePath));
            var clip = await MediaClip.CreateFromImageFileAsync(file, frameDuration);
            composition.Clips.Add(clip);
        }

        if (!string.IsNullOrWhiteSpace(narrationPath) && File.Exists(narrationPath))
        {
            var narrationFile = await StorageFile.GetFileFromPathAsync(Path.GetFullPath(narrationPath));
            var narration = await BackgroundAudioTrack.CreateFromFileAsync(narrationFile);
            narration.Volume = 1.0;
            composition.BackgroundAudioTracks.Add(narration);
        }

        var outputFile = await StorageFile.GetFileFromPathAsync(Path.GetFullPath(outputPath));
        var profile = MediaEncodingProfile.CreateMp4(VideoEncodingQuality.HD1080p);
        profile.Audio.Bitrate = 128000;
        var result = await composition.RenderToFileAsync(
            outputFile,
            MediaTrimmingPreference.Fast,
            profile);

        if (result != TranscodeFailureReason.None)
        {
            Console.Error.WriteLine("Media Foundation returned: " + result);
            return 3;
        }

        Log("Rendered " + frames.Length + " frames to " + outputPath);
        return 0;
    }

    public static int Main(string[] args)
    {
        if (args.Length != 4)
        {
            Console.Error.WriteLine("Usage: MediaCompositionRenderer <frames-dir> <narration.wav> <output.mp4> <fps>");
            return 1;
        }

        try
        {
            return RenderAsync(args[0], args[1], args[2], int.Parse(args[3]))
                .GetAwaiter()
                .GetResult();
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception);
            return 4;
        }
    }
}
