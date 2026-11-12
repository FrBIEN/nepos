<?php
/** Optional WebRTC rendezvous. Run on a PHP server; static hosting uses manual codes. */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Content-Type: text/plain; charset=utf-8');
$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'OPTIONS') { http_response_code(204); exit; }
function failRequest($status, $message) { http_response_code($status); exit($message); }
$action = $_GET['action'] ?? '';
if (!in_array($action, ['offer', 'answer'], true) || !in_array($method, ['GET', 'POST'], true)) failRequest(400, 'Invalid request');
$directory = sys_get_temp_dir() . '/filius-signaling-v1';
if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) failRequest(500, 'Storage unavailable');
// Bounded cleanup; expiry is also checked on every read/write.
foreach (array_slice(glob($directory . '/*.json') ?: [], 0, 100) as $file) {
    if (filemtime($file) < time() - 3600) @unlink($file);
}
function readDescription($type) {
    $input = file_get_contents('php://input', false, null, 0, 256001);
    if (!$input || strlen($input) > 256000) failRequest(413, 'Description missing or too large');
    $decoded = base64_decode(trim($input), true);
    $value = $decoded === false ? null : json_decode($decoded, true);
    if (!is_array($value) || ($value['type'] ?? '') !== $type || !is_string($value['sdp'] ?? null)) failRequest(400, 'Invalid description');
    return trim($input);
}
if ($action === 'offer' && $method === 'POST') {
    $offer = readDescription('offer');
    $id = bin2hex(random_bytes(16));
    if (file_put_contents($directory . '/' . $id . '.json', json_encode(['created' => time(), 'offer' => $offer, 'answer' => null]), LOCK_EX) === false) failRequest(500, 'Storage unavailable');
    chmod($directory . '/' . $id . '.json', 0600);
    header('Content-Type: application/json'); echo json_encode(['id' => $id]); exit;
}
$id = $_GET['id'] ?? '';
if (!is_string($id) || !preg_match('/\A[a-f0-9]{32}\z/', $id)) failRequest(400, 'Invalid session');
$path = $directory . '/' . $id . '.json';
if (!is_file($path)) failRequest(404, 'Session not found');
$handle = fopen($path, 'r+');
if (!$handle || !flock($handle, LOCK_EX)) failRequest(500, 'Storage unavailable');
$session = json_decode(stream_get_contents($handle), true);
if (!$session || ($session['created'] ?? 0) < time() - 3600) { fclose($handle); @unlink($path); failRequest(410, 'Session expired'); }
if ($action === 'answer' && $method === 'POST') {
    if ($session['answer'] !== null) { fclose($handle); failRequest(409, 'Session already answered'); }
    $session['answer'] = readDescription('answer'); rewind($handle); ftruncate($handle, 0); fwrite($handle, json_encode($session)); fflush($handle); fclose($handle); echo 'OK'; exit;
}
$result = $session[$action]; fclose($handle);
if ($result === null) { http_response_code(204); exit; }
echo $result;
