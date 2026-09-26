// ========== 全局变量 ==========
let scene, camera, renderer;
let gltfLoader = new THREE.GLTFLoader();
gltfLoader.crossOrigin = 'anonymous'; // 解决在线模型跨域问题

let currentModel = null;
let selectedModelUrl = "";
let reticle; // 平面检测准星
let hitTestSource = null;
let referenceSpace = null;

// MediaPipe 手势变量
let hands;
let videoElement;
let handLandmarks = [];
// 防抖滤波参数
let smoothWristX = 0, smoothWristY = 0;
let smoothScale = 1;
const alpha = 0.12; // 越小越平滑，延迟越高

// ========== 初始化场景 ==========
function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    // 启用AR平面检测特性
    renderer.xr.setSessionInit({
        optionalFeatures: ['local-floor', 'hit-test']
    });
    document.body.appendChild(renderer.domElement);

    // 环境灯光
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(1, 1.5, 1);
    scene.add(dirLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    // 创建平面检测准星（白色圆环）
    const ringGeo = new THREE.RingGeometry(0.08, 0.12, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    reticle = new THREE.Mesh(ringGeo, ringMat);
    reticle.rotation.x = -Math.PI / 2;
    reticle.visible = false;
    scene.add(reticle);

    // WebXR启动按钮
    const xrButton = new XRButton(renderer);
    document.body.appendChild(xrButton);

    // 进入AR会话后请求平面检测源
    renderer.xr.addEventListener('sessionstart', () => {
        const session = renderer.xr.getSession();
        referenceSpace = renderer.xr.getReferenceSpace();
        session.requestHitTestSource({ space: referenceSpace }).then(source => {
            hitTestSource = source;
        });
    });

    // 点击屏幕放置模型
    window.addEventListener('click', () => {
        if (reticle.visible && selectedModelUrl) {
            placeModel();
        }
    });

    // 初始化MediaPipe手部识别
    initMediaPipeHands();

    // 启动默认加载一批模型
    loadModelList("dragon");

    // 搜索框回车搜索
    document.getElementById("modelSearch").addEventListener("keydown", e=>{
        if(e.key === "Enter"){
            loadModelList(e.target.value.trim());
        }
    })

    renderer.setAnimationLoop(animate);
}

// ========== 放置模型到检测到的平面 ==========
function placeModel() {
    if (currentModel) scene.remove(currentModel);
    gltfLoader.load(selectedModelUrl, (gltf) => {
        currentModel = gltf.scene;
        // 复制准星的位置
        currentModel.position.copy(reticle.position);
        currentModel.scale.set(1,1,1);
        scene.add(currentModel);
    });
}

// ========== MediaPipe手势初始化 ==========
function initMediaPipeHands() {
    videoElement = document.createElement('video');
    videoElement.style.display = 'none';
    document.body.appendChild(videoElement);

    hands = new Hands({ 
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` 
    });
    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
    });
    hands.onResults(results => {
        handLandmarks = results.multiHandLandmarks;
    })

    const cam = new Camera(videoElement, {
        onFrame: async () => { await hands.send({ image: videoElement }); },
        width: 640,
        height: 480
    });
    cam.start();
}

// ========== 手势交互 + 低通滤波防抖 ==========
function handInteraction() {
    if (!currentModel || handLandmarks.length === 0) return;

    // 单手：旋转模型
    if (handLandmarks.length === 1) {
        const wrist = handLandmarks[0][0];
        // 低通滤波平滑坐标
        smoothWristX = smoothWristX * (1-alpha) + wrist.x * alpha;
        smoothWristY = smoothWristY * (1-alpha) + wrist.y * alpha;
        currentModel.rotation.y = smoothWristX * Math.PI * 1.6;
        currentModel.rotation.x = smoothWristY * Math.PI * 1.2;
    }

    // 双手：开合缩放模型
    if (handLandmarks.length >= 2) {
        const w0 = handLandmarks[0][0];
        const w1 = handLandmarks[1][0];
        const dist = Math.sqrt((w0.x-w1.x)**2 + (w0.y-w1.y)**2);
        let targetScale = dist * 2.8;
        smoothScale = smoothScale * (1-alpha) + targetScale * alpha;
        // 限制缩放范围
        smoothScale = THREE.MathUtils.clamp(smoothScale, 0.2, 2.5);
        currentModel.scale.set(smoothScale, smoothScale, smoothScale);
    }
}

// ========== 在线模型库：Poly Pizza API ==========
async function loadModelList(keyword){
    if(!keyword) return;
    const listEl = document.getElementById("modelList");
    listEl.innerHTML = '<p style="color:#fff;padding:8px;">加载中...</p>';

    try{
        const res = await fetch(`https://poly.pizza/api/v1.1/search?q=${encodeURIComponent(keyword)}&format=glb&limit=12`);
        const data = await res.json();
        listEl.innerHTML = "";

        if(!data.results || data.results.length===0){
            listEl.innerHTML = '<p style="color:#fff;padding:8px;">未找到模型，换个英文词试试</p>';
            return;
        }

        data.results.forEach((item, index)=>{
            const div = document.createElement("div");
            div.className = "model-item";
            if(index === 0) div.classList.add("active");
            div.innerHTML = `
                <img src="${item.thumbnail}" crossorigin="anonymous" alt="${item.title}">
                <p>${item.title.slice(0,6)}</p>
            `;
            // 点击切换模型
            div.onclick = ()=>{
                document.querySelectorAll(".model-item").forEach(i=>i.classList.remove("active"));
                div.classList.add("active");
                selectedModelUrl = item.download;
            }
            listEl.appendChild(div);

            // 默认选中第一个
            if(index === 0){
                selectedModelUrl = item.download;
            }
        })
    }catch(e){
        listEl.innerHTML = '<p style="color:#fff;padding:8px;">模型加载失败，检查网络</p>';
    }
}

// ========== 渲染循环 ==========
function animate(timestamp, frame) {
    // WebXR平面检测更新准星
    if (frame && hitTestSource) {
        const hitResults = frame.getHitTestResults(hitTestSource);
        if (hitResults.length > 0) {
            const hit = hitResults[0];
            const pose = hit.getPose(referenceSpace);
            reticle.visible = true;
            reticle.position.set(
                pose.transform.position.x,
                pose.transform.position.y,
                pose.transform.position.z
            );
        } else {
            reticle.visible = false;
        }
    }

    handInteraction();
    renderer.render(scene, camera);
}

// ========== 窗口自适应 ==========
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
})

// 启动
init();
