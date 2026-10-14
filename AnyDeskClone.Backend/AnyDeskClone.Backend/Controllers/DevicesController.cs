using Microsoft.AspNetCore.Mvc;
using AnyDeskClone.Backend.Models;
using AnyDeskClone.Backend.Services;

namespace AnyDeskClone.Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DevicesController : ControllerBase
{
    private readonly ISessionService _sessionService;

    public DevicesController(ISessionService sessionService)
    {
        _sessionService = sessionService;
    }

    [HttpGet]
    public IActionResult GetAllDevices()
    {
        var devices = _sessionService.GetAllDevices().Select(d => new DeviceStatusDto
        {
            DeviceId = d.DeviceId,
            DeviceName = d.DeviceName,
            IsOnline = d.IsOnline,
            ActiveSessionId = _sessionService.GetActiveSessionForDevice(d.DeviceId)?.SessionId
        });
        return Ok(devices);
    }

    [HttpGet("{id}")]
    public IActionResult GetDevice(string id)
    {
        var device = _sessionService.GetDevice(id);
        if (device == null)
        {
            return NotFound(new { message = $"Device {id} not found." });
        }
        return Ok(new DeviceStatusDto
        {
            DeviceId = device.DeviceId,
            DeviceName = device.DeviceName,
            IsOnline = device.IsOnline,
            ActiveSessionId = _sessionService.GetActiveSessionForDevice(device.DeviceId)?.SessionId
        });
    }

    [HttpGet("ice-servers")]
    public IActionResult GetIceServers()
    {
        // Public STUN servers for WebRTC peer-to-peer NAT traversal & LAN connections
        var servers = new List<IceServerConfig>
        {
            new() { Urls = ["stun:stun.l.google.com:19302"] },
            new() { Urls = ["stun:stun1.l.google.com:19302"] },
            new() { Urls = ["stun:stun2.l.google.com:19302"] }
        };
        return Ok(servers);
    }
}
