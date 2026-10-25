"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";

export type DisplayMode = "textured" | "clay" | "wire";

export type MeshStats = { triangles: number; vertices: number; meshes: number };

export type ViewerStatus = "idle" | "loading" | "ready" | "error";

type Props = {
  url: string | null;
  autoRotate: boolean;
  showGrid: boolean;
  display: DisplayMode;
  resetToken?: number;
  apiRef?: React.MutableRefObject<ViewerApi | null>;
  onStats?: (stats: MeshStats) => void;
  onStatus?: (status: ViewerStatus, message?: string) => void;
};

export type ViewerApi = {
  load: (url: string) => Promise<void>;
  clear: () => void;
  setAutoRotate: (value: boolean) => void;
  setGrid: (value: boolean) => void;
  setDisplay: (value: DisplayMode) => void;
  reset: () => void;
  dispose: () => void;
  /** PNG data URL of the current frame (transparent background) */
  snapshot: () => string | null;
  /** rotate to a fixed angle in degrees, for turntable captures */
  orbitTo: (degrees: number) => void;
};

export function ThreeViewer({
  url,
  autoRotate,
  showGrid,
  display,
  resetToken,
  apiRef: externalApiRef,
  onStats,
  onStatus,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const localApiRef = useRef<ViewerApi | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const propsRef = useRef({ url, autoRotate, showGrid, display, apiRef: externalApiRef, onStats, onStatus });
  propsRef.current = { url, autoRotate, showGrid, display, apiRef: externalApiRef, onStats, onStatus };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;
    let raf = 0;
    let api: ViewerApi | null = null;

    (async () => {
      try {
        const THREE = await import("three");
        const [{ OrbitControls }, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
          import("three/examples/jsm/controls/OrbitControls.js"),
          import("three/examples/jsm/loaders/GLTFLoader.js"),
          import("three/examples/jsm/environments/RoomEnvironment.js"),
        ]);
        if (cancelled) return;

        const width = mount.clientWidth || 720;
        const height = mount.clientHeight || 520;

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.12;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(38, width / height, 0.02, 120);
        camera.position.set(2.4, 1.7, 2.8);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.075;
        controls.rotateSpeed = 0.85;
        controls.zoomSpeed = 0.85;
        controls.enablePan = false;
        controls.maxPolarAngle = Math.PI * 0.495;
        controls.minDistance = 0.8;
        controls.maxDistance = 14;
        controls.target.set(0, 0.9, 0);
        controls.autoRotate = propsRef.current.autoRotate;
        controls.autoRotateSpeed = 1.15;

        // Image-based lighting
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envScene = new RoomEnvironment();
        const envTexture = pmrem.fromScene(envScene, 0.045);
        scene.environment = envTexture.texture;
        scene.environmentIntensity = 0.95;
        (envScene as unknown as { dispose?: () => void }).dispose?.();
        pmrem.dispose();

        const hemi = new THREE.HemisphereLight(0xc4d9ff, 0x080b11, 0.45);
        scene.add(hemi);

        const key = new THREE.DirectionalLight(0xfff6e8, 2.5);
        key.position.set(3.6, 6.2, 4.2);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.near = 0.5;
        key.shadow.camera.far = 24;
        key.shadow.camera.left = -4.5;
        key.shadow.camera.right = 4.5;
        key.shadow.camera.top = 4.5;
        key.shadow.camera.bottom = -4.5;
        key.shadow.bias = -0.0006;
        key.shadow.normalBias = 0.02;
        scene.add(key);

        const rim = new THREE.DirectionalLight(0x9ae600, 0.85);
        rim.position.set(-4.2, 2.6, -3.4);
        scene.add(rim);

        const fill = new THREE.DirectionalLight(0x67e8f9, 0.55);
        fill.position.set(-1.6, 2.2, 3.8);
        scene.add(fill);

        // Soft contact shadow catcher
        const groundGeo = new THREE.CircleGeometry(7, 64);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.36, color: 0x000000 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.002;
        ground.receiveShadow = true;
        scene.add(ground);

        const grid = new THREE.GridHelper(14, 28, 0x33465c, 0x161f2b);
        const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
        gridMaterials.forEach((material) => {
          material.transparent = true;
          material.opacity = 0.5;
          material.depthWrite = false;
        });
        grid.visible = propsRef.current.showGrid;
        scene.add(grid);

        // Loading / empty-state sculpture
        const placeholder = new THREE.Group();
        const wireMat = new THREE.MeshBasicMaterial({
          color: 0x9ae600,
          wireframe: true,
          transparent: true,
          opacity: 0.32,
        });
        const wireMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.98, 1), wireMat);
        const coreMat = new THREE.MeshStandardMaterial({
          color: 0x0d1520,
          metalness: 0.9,
          roughness: 0.24,
          emissive: 0x0d1f04,
          emissiveIntensity: 0.85,
        });
        const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.63, 2), coreMat);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x67e8f9,
          transparent: true,
          opacity: 0.28,
        });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.006, 8, 96), ringMat);
        ring.rotation.x = Math.PI * 0.42;
        placeholder.add(wireMesh, coreMesh, ring);
        placeholder.position.y = 1.02;
        placeholder.visible = !propsRef.current.url;
        scene.add(placeholder);

        const modelGroup = new THREE.Group();
        scene.add(modelGroup);

        const clayMaterial = new THREE.MeshStandardMaterial({
          color: 0xdfe8f4,
          roughness: 0.52,
          metalness: 0.04,
        });
        const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x9ae600, wireframe: true });

        let displayMode: DisplayMode = propsRef.current.display;
        let frameTarget = new THREE.Vector3(0, 1.02, 0);
        let frameRadius = 1.25;
        let loadToken = 0;
        let observer: ResizeObserver | null = null;

        const disposeMaterial = (material: THREE_NS.Material | THREE_NS.Material[]) => {
          const list = Array.isArray(material) ? material : [material];
          list.forEach((entry) => {
            if (entry !== clayMaterial && entry !== wireMaterial) entry.dispose?.();
          });
        };

        const disposeObject = (object: THREE_NS.Object3D) => {
          object.traverse((child) => {
            const mesh = child as THREE_NS.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry?.dispose?.();
            if (mesh.material) disposeMaterial(mesh.material as THREE_NS.Material | THREE_NS.Material[]);
          });
        };

        const clearModel = () => {
          loadToken += 1;
          for (const child of [...modelGroup.children]) {
            modelGroup.remove(child);
            disposeObject(child);
          }
          placeholder.visible = true;
          frameTarget = new THREE.Vector3(0, 1.02, 0);
          frameRadius = 1.3;
        };

        const applyDisplay = (mode: DisplayMode) => {
          displayMode = mode;
          modelGroup.traverse((child) => {
            const mesh = child as THREE_NS.Mesh;
            if (!mesh.isMesh) return;
            const original = mesh.userData.originalMaterial as THREE_NS.Material | THREE_NS.Material[] | undefined;
            if (!original) return;
            if (mode === "textured") mesh.material = original;
            else if (mode === "clay") mesh.material = clayMaterial;
            else mesh.material = wireMaterial;
          });
        };

        const frameContent = () => {
          const fov = (camera.fov * Math.PI) / 180;
          const distance = (frameRadius / Math.sin(fov / 2)) * 1.18;
          const direction = new THREE.Vector3(0.72, 0.44, 0.9).normalize();
          camera.position.copy(frameTarget).addScaledVector(direction, distance);
          camera.near = Math.max(distance / 200, 0.01);
          camera.far = distance * 30;
          camera.updateProjectionMatrix();
          controls.target.copy(frameTarget);
          controls.minDistance = Math.max(frameRadius * 0.55, 0.25);
          controls.maxDistance = Math.max(frameRadius * 9, 4);
          controls.update();
        };

        const applyStats = () => {
          let triangles = 0;
          let vertices = 0;
          let meshes = 0;
          modelGroup.traverse((child) => {
            const mesh = child as THREE_NS.Mesh;
            if (!mesh.isMesh || !mesh.geometry) return;
            meshes += 1;
            const geometry = mesh.geometry as THREE_NS.BufferGeometry;
            const position = geometry.getAttribute("position");
            const index = geometry.getIndex();
            if (position) vertices += position.count;
            triangles += index ? index.count / 3 : position ? position.count / 3 : 0;
          });
          propsRef.current.onStats?.({
            triangles: Math.round(triangles),
            vertices,
            meshes,
          });
        };

        const loader = new GLTFLoader();
        const load = async (modelUrl: string) => {
          const token = ++loadToken;
          propsRef.current.onStatus?.("loading");
          const response = await fetch(modelUrl);
          if (!response.ok) throw new Error(`Could not read the GLB (HTTP ${response.status}).`);
          const buffer = await response.arrayBuffer();
          const gltf = await loader.parseAsync(buffer, "");
          if (token !== loadToken || cancelled) {
            disposeObject(gltf.scene);
            return;
          }

          for (const child of [...modelGroup.children]) {
            modelGroup.remove(child);
            disposeObject(child);
          }

          const root = gltf.scene;
          const box = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);
          const maxDimension = Math.max(size.x, size.y, size.z) || 1;
          const scale = 1.75 / maxDimension;
          const heightAfterScale = Math.max(size.y * scale, 0.35);

          const wrapper = new THREE.Group();
          root.position.set(-center.x, -center.y, -center.z);
          wrapper.add(root);
          wrapper.scale.setScalar(scale);
          wrapper.position.y = heightAfterScale / 2;

          root.traverse((child) => {
            const mesh = child as THREE_NS.Mesh;
            if (mesh.isMesh) {
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              mesh.userData.originalMaterial = mesh.material;
            }
          });

          modelGroup.add(wrapper);
          placeholder.visible = false;
          applyDisplay(displayMode);

          const sphere = new THREE.Box3().setFromObject(wrapper).getBoundingSphere(new THREE.Sphere());
          frameTarget = sphere.center.clone();
          frameRadius = Math.max(sphere.radius, 0.25);
          frameContent();
          applyStats();
          propsRef.current.onStatus?.("ready");
        };

        const removeModel = () => {
          clearModel();
          frameContent();
          propsRef.current.onStatus?.("idle");
        };

        api = {
          load,
          clear: removeModel,
          setAutoRotate: (value) => {
            controls.autoRotate = value;
          },
          setGrid: (value) => {
            grid.visible = value;
          },
          setDisplay: (value) => applyDisplay(value),
          reset: () => frameContent(),
          snapshot: () => {
            try {
              renderer.render(scene, camera);
              return renderer.domElement.toDataURL("image/png");
            } catch {
              return null;
            }
          },
          orbitTo: (degrees: number) => {
            const radius = camera.position.distanceTo(controls.target);
            const phi = Math.acos(THREE.MathUtils.clamp((camera.position.y - controls.target.y) / radius, -1, 1));
            const theta = (degrees * Math.PI) / 180;
            camera.position.set(
              controls.target.x + radius * Math.sin(phi) * Math.sin(theta),
              controls.target.y + radius * Math.cos(phi),
              controls.target.z + radius * Math.sin(phi) * Math.cos(theta),
            );
            camera.lookAt(controls.target);
            controls.update();
            renderer.render(scene, camera);
          },
          dispose: () => {
            loadToken += 1;
            cancelAnimationFrame(raf);
            observer?.disconnect();
            controls.dispose();
            for (const child of [...modelGroup.children]) {
              modelGroup.remove(child);
              disposeObject(child);
            }
            placeholder.traverse((child) => {
              const mesh = child as THREE_NS.Mesh;
              if (mesh.isMesh) {
                mesh.geometry?.dispose?.();
                (mesh.material as THREE_NS.Material)?.dispose?.();
              }
            });
            groundGeo.dispose();
            groundMat.dispose();
            clayMaterial.dispose();
            wireMaterial.dispose();
            envTexture.dispose();
            grid.geometry.dispose();
            gridMaterials.forEach((material) => material.dispose());
            renderer.dispose();
            if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
          },
        };

        localApiRef.current = api;
        if (propsRef.current.apiRef) propsRef.current.apiRef.current = api;
        api.setAutoRotate(propsRef.current.autoRotate);
        api.setGrid(propsRef.current.showGrid);
        applyDisplay(propsRef.current.display);
        frameContent();

        observer = new ResizeObserver(() => {
          const w = mount.clientWidth || 1;
          const h = mount.clientHeight || 1;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        });
        observer.observe(mount);

        const clock = new THREE.Clock();
        const tick = () => {
          raf = requestAnimationFrame(tick);
          const delta = Math.min(clock.getDelta(), 0.1);
          if (placeholder.visible) {
            placeholder.rotation.y += delta * 0.45;
            ring.rotation.z += delta * 0.25;
            coreMesh.rotation.y -= delta * 0.18;
          }
          controls.update();
          renderer.render(scene, camera);
        };
        tick();

        if (propsRef.current.url) {
          load(propsRef.current.url).catch((error: unknown) => {
            propsRef.current.onStatus?.("error", error instanceof Error ? error.message : "Could not load the model.");
          });
        }
      } catch (error) {
        if (!cancelled) {
          setFailure(
            error instanceof Error
              ? `3D preview unavailable: ${error.message}`
              : "WebGL is not available in this browser.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      api?.dispose();
      api = null;
      localApiRef.current = null;
      if (propsRef.current.apiRef) propsRef.current.apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    localApiRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  useEffect(() => {
    localApiRef.current?.setGrid(showGrid);
  }, [showGrid]);

  useEffect(() => {
    localApiRef.current?.setDisplay(display);
  }, [display]);

  useEffect(() => {
    localApiRef.current?.reset();
  }, [resetToken]);

  useEffect(() => {
    const api = localApiRef.current;
    if (!api) return;
    if (!url) {
      api.clear();
      return;
    }
    api.load(url).catch((error: unknown) => {
      propsRef.current.onStatus?.("error", error instanceof Error ? error.message : "Could not load the model.");
    });
  }, [url]);

  return (
    <div className="viewer-canvas absolute inset-0">
      <div ref={mountRef} className="h-full w-full" />
      {failure ? (
        <div className="absolute inset-0 grid place-items-center bg-ink-950/80 px-8 text-center">
          <p className="max-w-sm text-sm text-mist-300">{failure}</p>
        </div>
      ) : null}
    </div>
  );
}
