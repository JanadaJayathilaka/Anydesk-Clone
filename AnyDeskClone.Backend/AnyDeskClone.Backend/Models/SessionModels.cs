namespace AnyDeskClone.Backend.Models;

public enum SessionState
{
    Pending,
    WaitingApproval,
    Approved,
    Active,
    Rejected,
    Ended,
    TimedOut
}

public class SessionPermissions
{
    public bool AllowControl { get; set; } = true;
    public bool AllowMouse { get; set; } = true;
    public bool AllowKeyboard { get; set; } = true;
    public bool AllowClipboard { get; set; } = true;
    public bool AllowAudio { get; set; } = false;
}

public class RemoteSession
{
    public string SessionId { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string HostDeviceId { get; set; } = string.Empty;
    public string ControllerDeviceId { get; set; } = string.Empty;
    public string ControllerName { get; set; } = "Remote User";
    public SessionState State { get; set; } = SessionState.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public SessionPermissions Permissions { get; set; } = new();
}

public class SessionRequestDto
{
    public string HostDeviceId { get; set; } = string.Empty;
    public string ControllerDeviceId { get; set; } = string.Empty;
    public string ControllerName { get; set; } = "Remote Controller";
}

public class SessionApprovalDto
{
    public bool Approved { get; set; }
    public SessionPermissions Permissions { get; set; } = new();
}

public class SessionResponseDto
{
    public string SessionId { get; set; } = string.Empty;
    public string HostDeviceId { get; set; } = string.Empty;
    public string ControllerDeviceId { get; set; } = string.Empty;
    public string ControllerName { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public SessionPermissions Permissions { get; set; } = new();
}
