"""画风探索的无状态基础候选算法。

本模块只处理可复现的候选构造，不读取文件、不写任务记录，也不发起
NovelAI 请求。调用方应为一次任务/轮次持有一个 ``random.Random``，以便
把随机种子写入任务记录后重放候选。

离散程度使用 0.0（最集中于众数）到 1.0（最分散）的连续值。应用层如
使用百分比滑块，应在进入本模块前除以 100。
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
import math
import random
from typing import Sequence


MIN_WEIGHT = -3.0
MAX_WEIGHT = 3.0
WEIGHT_STEP = 0.1
_EPSILON = 1e-9


@dataclass(frozen=True)
class WeightSamplingConfig:
    """基础探索的一组权重参数。

    ``mode`` 是分布的中心，而非保证每次采样都会返回的值。左右离散程度
    独立控制从中心向该方向移动的距离分布。
    """

    lower: float = 0.1
    upper: float = 2.0
    mode: float = 0.8
    left_dispersion: float = 0.4
    right_dispersion: float = 0.4
    soft_balance_strength: float = 0.0


@dataclass(frozen=True)
class ArtistWeight:
    artist_id: str
    weight: float


@dataclass(frozen=True)
class BasicCandidate:
    """可直接拼入正面提示词的基础探索候选。"""

    artist_weights: tuple[ArtistWeight, ...]
    artist_string: str


def validate_weight_config(config: WeightSamplingConfig) -> None:
    """验证配置，失败时抛出 ``ValueError``。

    范围端点也要求处在 0.1 网格上。这样“截断再离散化”永远不会把一个
    合法端点变成非 0.1 的结果，且与 UI 的 0.1 步长保持一致。
    """

    values = (config.lower, config.upper, config.mode, config.left_dispersion,
              config.right_dispersion, config.soft_balance_strength)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("权重参数必须是有限数字")
    if config.lower < MIN_WEIGHT or config.upper > MAX_WEIGHT:
        raise ValueError("权重范围必须位于 -3.0 到 3.0")
    if config.lower > config.upper:
        raise ValueError("权重下界不能大于上界")
    if not config.lower - _EPSILON <= config.mode <= config.upper + _EPSILON:
        raise ValueError("众数必须位于权重范围内")
    if not _is_step_aligned(config.lower) or not _is_step_aligned(config.upper):
        raise ValueError("权重上下界必须使用 0.1 步长")
    for name, value in (
        ("左侧离散程度", config.left_dispersion),
        ("右侧离散程度", config.right_dispersion),
        ("软平衡强度", config.soft_balance_strength),
    ):
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"{name}必须位于 0 到 1")


def dispersion_to_beta_shape(dispersion: float) -> tuple[float, float]:
    """把离散程度映射为“距众数距离”的 Beta(alpha, beta)。

    使用 ``Beta(1, beta)``：低离散度时 beta 大，距离集中在 0；高离散度
    时 beta 接近 1，距离接近均匀。这个函数单独暴露，供统计测试锁定 UI
    参数的含义。
    """

    if not math.isfinite(dispersion) or not 0.0 <= dispersion <= 1.0:
        raise ValueError("离散程度必须位于 0 到 1")
    # 0 -> Beta(1, 12)，1 -> Beta(1, 1)。保持单调且不退化为固定值。
    return 1.0, 12.0 - 11.0 * dispersion


def sample_split_beta_weight(
    config: WeightSamplingConfig, rng: random.Random | None = None
) -> float:
    """按 Split-Beta 连续采样一个权重（尚未软平衡和离散化）。"""

    validate_weight_config(config)
    source = rng if rng is not None else random.Random()
    left_length = config.mode - config.lower
    right_length = config.upper - config.mode

    if left_length <= _EPSILON and right_length <= _EPSILON:
        return config.mode
    if left_length <= _EPSILON:
        return _sample_side(config.mode, right_length, config.right_dispersion, 1, source)
    if right_length <= _EPSILON:
        return _sample_side(config.mode, left_length, config.left_dispersion, -1, source)

    # 区间越长，落入该侧的机会越大；这避免短侧因“各 50%”而被过度放大。
    choose_left = source.random() < left_length / (left_length + right_length)
    if choose_left:
        return _sample_side(config.mode, left_length, config.left_dispersion, -1, source)
    return _sample_side(config.mode, right_length, config.right_dispersion, 1, source)


def soft_balance_weights(
    weights: Sequence[float], config: WeightSamplingConfig
) -> list[float]:
    """对一串权重做有限的、朝众数回拉的组合级修正。

    修正量为 ``(mode - mean(weights)) * strength``，所有元素同向平移。
    因而它只减弱整串共同偏高/偏低，不改变成员之间的相对差距，也不会用
    硬性重采样把每一串变成同一种结构。关闭或强度为 0 时返回等值副本。
    """

    validate_weight_config(config)
    result = [float(weight) for weight in weights]
    if not result or config.soft_balance_strength == 0.0:
        return result
    if not all(math.isfinite(weight) for weight in result):
        raise ValueError("待平衡权重必须是有限数字")
    mean = sum(result) / len(result)
    shift = (config.mode - mean) * config.soft_balance_strength
    return [_clamp(weight + shift, config.lower, config.upper) for weight in result]


def discretize_weight(value: float, lower: float, upper: float) -> float:
    """截断并以十进制“四舍五入”到 0.1，避免负数和浮点误差问题。"""

    if not all(math.isfinite(item) for item in (value, lower, upper)):
        raise ValueError("权重必须是有限数字")
    if lower > upper:
        raise ValueError("权重下界不能大于上界")
    if not _is_step_aligned(lower) or not _is_step_aligned(upper):
        raise ValueError("权重上下界必须使用 0.1 步长")
    clipped = _clamp(value, lower, upper)
    rounded = Decimal(str(clipped)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    # 端点已在网格上，第二次截断既保留步长又消除任何越界风险。
    return float(min(Decimal(str(upper)), max(Decimal(str(lower)), rounded)))


def sample_weight(config: WeightSamplingConfig, rng: random.Random | None = None) -> float:
    """按规范执行：连续采样 → 单值平衡 → 截断/0.1 离散化。"""

    continuous = sample_split_beta_weight(config, rng)
    balanced = soft_balance_weights([continuous], config)[0]
    return discretize_weight(balanced, config.lower, config.upper)


def build_artist_string(artist_weights: Sequence[ArtistWeight]) -> str:
    """使用 NovelAI 权重语法生成 Artist String，例如 ``0.8::artist::``。"""

    if not artist_weights:
        raise ValueError("Artist String 至少需要一个 ID")
    parts: list[str] = []
    for item in artist_weights:
        artist_id = item.artist_id.strip()
        if not artist_id:
            raise ValueError("Artist ID 不能为空")
        if not math.isfinite(item.weight):
            raise ValueError("Artist 权重必须是有限数字")
        parts.append(f"{item.weight:.1f}::{artist_id}::")
    return ", ".join(parts)


def generate_basic_candidate(
    artist_pool: Sequence[str],
    min_artist_count: int,
    config: WeightSamplingConfig,
    rng: random.Random | None = None,
) -> BasicCandidate:
    """从最少数量到 10 个 ID 中随机取样，并生成 Artist String。

    实际上限还受池子大小约束；每个候选都会重新随机实际数量。因此最少
    数量为 2 时，不是固定抽取 2 个，而是在 2～min(10, 池大小) 间抽取。
    """

    validate_weight_config(config)
    pool = _validated_pool(artist_pool)
    if not 1 <= min_artist_count <= 10:
        raise ValueError("最少抽取 ID 数目必须为 1 到 10")
    if min_artist_count > len(pool):
        raise ValueError("ArtistPool 中的 ID 数量不足")
    source = rng if rng is not None else random.Random()
    actual_count = source.randint(min_artist_count, min(10, len(pool)))
    selected = source.sample(pool, actual_count)
    continuous = [sample_split_beta_weight(config, source) for _ in selected]
    balanced = soft_balance_weights(continuous, config)
    artist_weights = tuple(
        ArtistWeight(artist_id, discretize_weight(weight, config.lower, config.upper))
        for artist_id, weight in zip(selected, balanced)
    )
    return BasicCandidate(artist_weights, build_artist_string(artist_weights))


def generate_basic_candidates(
    artist_pool: Sequence[str],
    min_artist_count: int,
    candidate_count: int,
    config: WeightSamplingConfig,
    rng: random.Random | None = None,
) -> list[BasicCandidate]:
    """在同一随机源下批量构造基础探索候选。"""

    if candidate_count < 1:
        raise ValueError("候选数量至少为 1")
    source = rng if rng is not None else random.Random()
    return [
        generate_basic_candidate(artist_pool, min_artist_count, config, source)
        for _ in range(candidate_count)
    ]


def _sample_side(
    mode: float, length: float, dispersion: float, direction: int, rng: random.Random
) -> float:
    alpha, beta = dispersion_to_beta_shape(dispersion)
    distance = rng.betavariate(alpha, beta) * length
    return mode + direction * distance


def _validated_pool(artist_pool: Sequence[str]) -> list[str]:
    pool = [artist_id.strip() for artist_id in artist_pool if artist_id and artist_id.strip()]
    if not pool:
        raise ValueError("ArtistPool 不能为空")
    # 池子服务会保序去重；这里仍拒绝重复，避免候选无放回却重复 ID。
    if len(pool) != len(set(pool)):
        raise ValueError("ArtistPool 不能包含重复 ID")
    return pool


def _is_step_aligned(value: float) -> bool:
    return abs(value * 10 - round(value * 10)) < _EPSILON


def _clamp(value: float, lower: float, upper: float) -> float:
    return min(upper, max(lower, value))
