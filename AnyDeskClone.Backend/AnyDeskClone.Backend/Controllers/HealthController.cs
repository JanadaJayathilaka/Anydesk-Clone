using Microsoft.AspNetCore.Mvc;
using AnyDeskClone.Backend.Services;

namespace AnyDeskClone.Backend.Controllers;

[ApiController]
[Route("[controller]")]
public class HealthController : ControllerBase
{
    private readonly ISessionService _sessionService;
    private static readonly DateTime StartTime = DateTime.UtcNow;

    public HealthController(ISessionService sessionService)
    {
        _sessionService = sessionService;
    }

    [HttpGet]
    public IActionResult Get()
    {
        return Ok(new
        {
            status = "Healthy",
            timestamp = DateTime.UtcNow,
            uptimeSeconds = (int)(DateTime.UtcNow - StartTime).TotalSeconds,
            activeDevices = _sessionService.ActiveDeviceCount,
            activeSessions = _sessionService.ActiveSessionCount,
            version = "1.0.0",
            platform = Environment.OSVersion.ToString()
        });
    }
}
