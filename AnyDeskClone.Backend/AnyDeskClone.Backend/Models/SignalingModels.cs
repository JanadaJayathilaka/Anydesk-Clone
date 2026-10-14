namespace AnyDeskClone.Backend.Models;

public class SignalMessage
{
    public string SessionId { get; set; } = string.Empty;
    public string SenderDeviceId { get; set; } = string.Empty;
    public string TargetDeviceId { get; set; } = string.Empty;
    /// <summary>
    /// Type can be "offer", "answer", "candidate", "ping", "pong", "chat", "status"
    /// </summary>
    public string Type { get; set; } = string.Empty;
    public object? Payload { get; set; }
}

public class RemoteInputEvent
{
    public string SessionId { get; set; } = string.Empty;
    /// <summary>
    /// "mousemove", "mousedown", "mouseup", "click", "wheel", "keydown", "keyup", "specialkey"
    /// </summary>
    public string Type { get; set; } = string.Empty;
    public double NormalizedX { get; set; }
    public double NormalizedY { get; set; }
    public int Button { get; set; } // 0 = left, 1 = middle, 2 = right
    public double DeltaX { get; set; }
    public double DeltaY { get; set; }
    public string? Key { get; set; }
    public string? Code { get; set; }
    public int KeyCode { get; set; }
    public bool CtrlKey { get; set; }
    public bool AltKey { get; set; }
    public bool ShiftKey { get; set; }
    public bool MetaKey { get; set; }
    public string? SpecialKey { get; set; }
}
