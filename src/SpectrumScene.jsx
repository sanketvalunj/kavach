import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Float } from '@react-three/drei';
import * as THREE from 'three';
import { useSimulationStore } from './store/simulationStore';

function Cylinder() {
  const group = useRef();
  const marker = useRef();
  const burstNodes = useRef([]);
  const trail = useRef([]);
  const burstData = useSimulationStore(s => s.cylinderBursts);
  const receiver = useSimulationStore(s => s.receiverState);
  const constraints = useSimulationStore(s => s.receiverConstraints);
  const bursts = useMemo(() => burstData.map((sample) => ({
    angle: sample.angleRadians,
    z: sample.axialPosition,
    amplitude: sample.amplitude,
    radius: .011 + sample.amplitude * .029,
    hot: sample.amplitude > .76,
    key: sample.id,
  })), [burstData]);
  const shadow = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,.48)'); grad.addColorStop(.42, 'rgba(0,0,0,.22)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }, []);
  useFrame((state, delta) => {
    const simulation = useSimulationStore.getState();
    const running = simulation.dataSource === 'OFFLINE' && simulation.simulationStatus === 'RUNNING';
    const simulationSeconds = running ? simulation.elapsedSimulationMs / 1000 : 0;
    if (group.current) group.current.rotation.z = .06 + simulationSeconds * .025;
    burstNodes.current.forEach((node, i) => {
      if (!node) return;
      const pulse = bursts[i];
      if (!pulse) return;
      // Each return circulates around the RF field at its own rate and drifts
      // along the cylinder as the simulation clock advances.
      const angle = pulse.angle + simulationSeconds * (.055 + pulse.amplitude * .085);
      const z = pulse.z + Math.sin(simulationSeconds * .52 + i * 1.71) * .11;
      node.position.set(Math.cos(angle) * 1.522, Math.sin(angle) * 1.522, z);
      const pulseScale = running ? 1 + Math.sin(simulationSeconds * 3.8 + i) * .12 : 1;
      node.scale.setScalar(pulseScale);
    });
    if (marker.current) {
      const frequencyOffset = ((receiver.currentFrequencyGHz - 8.42) / (constraints.frequencyMaxGHz - constraints.frequencyMinGHz)) * Math.PI * 2;
      const angle = .24 + Math.sin(simulationSeconds * .42) * .56 + frequencyOffset;
      const z = .66 + Math.sin(simulationSeconds * .3) * .27 + frequencyOffset * .1;
      const next = new THREE.Vector3(Math.cos(angle) * 1.53, Math.sin(angle) * 1.53, z);
      marker.current.position.lerp(next, 1 - Math.exp(-delta * 1.5));
      marker.current.rotation.set(0, Math.PI / 2 - angle, angle);
      trail.current.forEach((node, i) => {
        const lag = (i + 1) * .12;
        const a = angle - lag;
        node.position.set(Math.cos(a) * 1.53, Math.sin(a) * 1.53, z - lag * .6);
      });
    }
  });
  return <group scale={1.13}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.53, 0]}>
      <planeGeometry args={[4.9, 3.6]} /><meshBasicMaterial map={shadow} transparent depthWrite={false} opacity={.62} />
    </mesh>
    <group ref={group} rotation={[.04, -.06, .06]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.5, 1.5, 2.2, 72, 1, true]} />
        <meshBasicMaterial color="#243234" side={THREE.DoubleSide} transparent opacity={.4} />
      </mesh>
      {[-1.08, -.36, .36, 1.08].map((z, i) => <mesh key={z} position={[0, 0, z]}>
        <torusGeometry args={[1.51, i === 1 ? .008 : .004, 6, 96]} />
        <meshBasicMaterial color={i === 1 ? '#61b3a9' : '#4d7772'} transparent opacity={i === 1 ? .72 : .42} toneMapped={false} />
      </mesh>)}
      {Array.from({ length: 36 }, (_, i) => <mesh key={i} rotation={[0, 0, (i / 36) * Math.PI * 2]}>
        <cylinderGeometry args={[1.514, 1.514, 2.15, 1, 1, true, 0, .002]} />
        <meshBasicMaterial color="#528b84" transparent opacity={.42} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>)}
      {bursts.map((p, i) => <group key={p.key} ref={node => { burstNodes.current[i] = node; }} position={[Math.cos(p.angle) * 1.522, Math.sin(p.angle) * 1.522, p.z]}>
        {p.hot && <mesh><sphereGeometry args={[p.radius * 2.4, 10, 10]} /><meshBasicMaterial color="#69cfbf" transparent opacity={.11 + p.amplitude * .11} toneMapped={false} /></mesh>}
        <mesh>
          <sphereGeometry args={[p.radius, 10, 10]} />
          <meshBasicMaterial color={p.hot ? '#70d7c7' : '#579e95'} transparent opacity={.36 + p.amplitude * .62} toneMapped={false} />
        </mesh>
      </group>)}
      {Array.from({ length: 5 }, (_, i) => <mesh key={i} ref={(node) => { trail.current[i] = node; }}>
        <sphereGeometry args={[.055 - i * .007, 9, 9]} /><meshBasicMaterial color="#f3bd7d" transparent opacity={.48 - i * .07} toneMapped={false} />
      </mesh>)}
      <group ref={marker}>
        <group>
          <mesh><torusGeometry args={[.15, .016, 10, 40]} /><meshBasicMaterial color="#f0c58d" toneMapped={false} /></mesh>
          <mesh><torusGeometry args={[.205, .004, 6, 40]} /><meshBasicMaterial color="#d5a56a" transparent opacity={.72} toneMapped={false} /></mesh>
          <mesh position={[0, 0, .035]}><sphereGeometry args={[.043, 12, 12]} /><meshBasicMaterial color="#fff0d6" toneMapped={false} /></mesh>
        </group>
        <mesh position={[0, .24, 0]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[.055, .17, 12]} /><meshBasicMaterial color="#e8bc84" /></mesh>
      </group>
    </group>
  </group>;
}

export default function SpectrumScene() {
  return <Canvas dpr={[1, 1.5]} camera={{ position: [3.6, 2.7, 4.5], fov: 37 }} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}>
    <color attach="background" args={['#101517']} />
    <fog attach="fog" args={['#101517', 7, 13]} />
    <ambientLight intensity={.48} color="#b3c7c0" />
    <spotLight position={[-4, 5, 5]} angle={.62} penumbra={.8} intensity={22} distance={14} color="#d7e5dc" />
    <pointLight position={[0, 2, -4]} intensity={5} distance={9} color="#4daba0" />
    <pointLight position={[3, -2, 2]} intensity={2.5} distance={7} color="#52716b" />
    <Float speed={.38} rotationIntensity={.008} floatIntensity={.025}><Cylinder /></Float>
    <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={.72} maxPolarAngle={2.28} enableDamping dampingFactor={.08} autoRotate autoRotateSpeed={.1} />
  </Canvas>;
}
