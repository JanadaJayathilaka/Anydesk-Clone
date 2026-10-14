namespace AnyDeskClone.Backend.Models;

public class DeviceRegistration
{
    public string DeviceId { get; set; } = string.Empty;
    public string DeviceName { get; set; } = "Windows PC";
    public string OsPlatform { get; set; } = "Windows";
    public string ConnectionId { get; set; } = string.Empty;
    public DateTime ConnectedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastHeartbeat { get; set; } = DateTime.UtcNow;
    public bool IsOnline => (DateTime.UtcNow - LastHeartbeat).TotalSeconds < 30;
}

public class DeviceStatusDto
{
    public string DeviceId { get; set; } = string.Empty;
    public string DeviceName { get; set; } = string.Empty;
    public bool IsOnline { get; set; }
    public string? ActiveSessionId { get; set; }
}

public class IceServerConfig
{
    public string[] Urls { get; set; } = [];
    public string? Username { get; set; }
    public string? Credential { get; set; }
}
