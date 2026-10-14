using AnyDeskClone.Backend.Hubs;
using AnyDeskClone.Backend.Services;

var builder = WebApplication.CreateBuilder(args);

// Ensure backend listens on all network adapters for LAN peer access
if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    builder.WebHost.UseUrls("http://0.0.0.0:5082");
}

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Register SignalR for real-time WebRTC signaling and presence
builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = true;
});

// Register custom services
builder.Services.AddSingleton<ISessionService, SessionService>();
builder.Services.AddSingleton<IInputSimulatorService, WindowsInputSimulator>();

// Configure flexible CORS for Vite dev server, Electron and local network peers
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.SetIsOriginAllowed(_ => true)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();

app.UseAuthorization();

app.MapControllers();
app.MapHub<SessionHub>("/hubs/session");

app.Run();
