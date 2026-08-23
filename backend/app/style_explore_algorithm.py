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
import re
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


@dataclass(frozen=True)
class DeepParent:
    """深度探索父本；偏好只影响抽样频率，不表达绝对评分。"""

    parent_id: str
    artist_weights: tuple[ArtistWeight, ...]
    preference: float = 1.0

    @classmethod
    def from_artist_string(
        cls, parent_id: str, artist_string: str, preference: float = 1.0
    ) -> "DeepParent":
        return cls(parent_id, parse_artist_string(artist_string), preference)


@dataclass(frozen=True)
class WeightChange:
    """候选相对父本的单个 ID 权重/成员变化。``None`` 表示新增或移除。"""

    artist_id: str
    before: float | None
    after: float | None


@dataclass(frozen=True)
class DeepCandidate:
    """带可回溯谱系的深度探索候选。"""

    artist_weights: tuple[ArtistWeight, ...]
    artist_string: str
    parent_ids: tuple[str, ...]
    operation: str
    weight_changes: tuple[WeightChange, ...]


_ARTIST_STRING_ITEM = re.compile(
    r"\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))::(.+?)::\s*(?:,\s*|$)"
)


def parse_artist_string(artist_string: str) -> tuple[ArtistWeight, ...]:
    """解析本模块生成的加权 Artist String，并保留 ID 内的转义字符。"""

    raw = (artist_string or "").strip()
    if not raw:
        raise ValueError("Artist String 不能为空")
    items: list[ArtistWeight] = []
    position = 0
    while position < len(raw):
        match = _ARTIST_STRING_ITEM.match(raw, position)
        if match is None:
            raise ValueError("Artist String 格式无效")
        weight = float(match.group(1))
        artist_id = match.group(2).strip()
        if not artist_id or not math.isfinite(weight):
            raise ValueError("Artist String 格式无效")
        items.append(ArtistWeight(artist_id, weight))
        position = match.end()
    if len({item.artist_id for item in items}) != len(items):
        raise ValueError("Artist String 不能包含重复 ID")
    return tuple(items)


def suggest_deep_candidate_count(parent_count: int) -> int:
    """建议一轮生成量：``4 × P`` 取最近的 5，且最低为 10。"""

    if parent_count < 1:
        raise ValueError("当前父本数至少为 1")
    return max(10, ((4 * parent_count + 2) // 5) * 5)


def suggest_next_parent_count(candidate_count: int) -> int:
    """建议下一轮父本数：``ceil(sqrt(N))``，限制在 3～10。"""

    if candidate_count < 1:
        raise ValueError("候选数量至少为 1")
    return min(10, max(3, math.ceil(math.sqrt(candidate_count))))


def generate_deep_candidates(
    parents: Sequence[DeepParent],
    artist_pool: Sequence[str],
    candidate_count: int,
    config: WeightSamplingConfig,
    rng: random.Random | None = None,
) -> list[DeepCandidate]:
    """生成一轮可回溯的深度探索候选。

    接口保证每个父本至少有一个局部变异，并至少保留一个随机注入名额，
    因而目标数必须大于父本数。无法在有限组合空间内产生足量唯一候选时
    会明确失败，而不是静默返回重复或不足数量的结果。
    """

    validate_weight_config(config)
    pool = _validated_pool(artist_pool)
    normalized_parents = _validated_deep_parents(parents, pool, config)
    if candidate_count <= len(normalized_parents):
        raise ValueError("深度候选数量必须大于父本数，以保留随机注入名额")
    source = rng if rng is not None else random.Random()
    results: list[DeepCandidate] = []
    seen: set[tuple[tuple[str, float], ...]] = set()

    def append_unique(factory, attempts: int = 240) -> None:
        for _ in range(attempts):
            candidate = factory()
            key = _candidate_key(candidate.artist_weights)
            if key not in seen:
                seen.add(key)
                results.append(candidate)
                return
        raise ValueError("当前父本、池子和权重范围无法产生足量唯一深度候选")

    # 公平性硬约束：即使偏好很低，每个父本也不会失去探索机会。
    for parent in normalized_parents:
        append_unique(lambda parent=parent: _local_mutation(parent, pool, config, source))

    remaining = candidate_count - len(results)
    injection_count = min(remaining, max(1, round(candidate_count * 0.1)))
    for _ in range(injection_count):
        append_unique(lambda: _random_injection(pool, config, source))

    while len(results) < candidate_count:
        if len(normalized_parents) > 1 and source.random() < 0.65:
            append_unique(lambda: _crossover(normalized_parents, config, source))
        else:
            append_unique(
                lambda: _local_mutation(
                    _weighted_parent(normalized_parents, source), pool, config, source
                )
            )
    return results


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


def _validated_deep_parents(
    parents: Sequence[DeepParent], pool: Sequence[str], config: WeightSamplingConfig
) -> list[DeepParent]:
    if not parents:
        raise ValueError("当前父本集不能为空")
    pool_set = set(pool)
    normalized: list[DeepParent] = []
    parent_ids: set[str] = set()
    parent_keys: set[tuple[tuple[str, float], ...]] = set()
    for parent in parents:
        parent_id = (parent.parent_id or "").strip()
        if not parent_id or parent_id in parent_ids:
            raise ValueError("父本 ID 不能为空或重复")
        if not math.isfinite(parent.preference) or parent.preference < 0:
            raise ValueError("父本偏好必须是非负有限数字")
        if not 1 <= len(parent.artist_weights) <= 10:
            raise ValueError("每个父本必须包含 1 到 10 个 Artist ID")
        ids = [item.artist_id.strip() for item in parent.artist_weights]
        if any(not artist_id for artist_id in ids) or len(ids) != len(set(ids)):
            raise ValueError("父本 Artist ID 不能为空或重复")
        if any(artist_id not in pool_set for artist_id in ids):
            raise ValueError("父本 Artist ID 必须来自当前 ArtistPool")
        if any(not math.isfinite(item.weight) for item in parent.artist_weights):
            raise ValueError("父本权重必须是有限数字")
        weights = tuple(
            ArtistWeight(
                artist_id,
                discretize_weight(item.weight, config.lower, config.upper),
            )
            for artist_id, item in zip(ids, parent.artist_weights)
        )
        key = _candidate_key(weights)
        if key in parent_keys:
            raise ValueError("当前父本集不能包含等价 Artist String")
        parent_ids.add(parent_id)
        parent_keys.add(key)
        normalized.append(DeepParent(parent_id, weights, float(parent.preference)))
    return normalized


def _local_mutation(
    parent: DeepParent,
    pool: Sequence[str],
    config: WeightSamplingConfig,
    rng: random.Random,
) -> DeepCandidate:
    weights = list(parent.artist_weights)
    used = {item.artist_id for item in weights}
    actions: list[str] = []
    if any(
        item.weight - WEIGHT_STEP >= config.lower - _EPSILON
        or item.weight + WEIGHT_STEP <= config.upper + _EPSILON
        for item in weights
    ):
        actions.append("weight")
    if len(used) < len(pool):
        actions.append("replace")
        if len(weights) < min(10, len(pool)):
            actions.append("add")
    if len(weights) > 1:
        actions.append("remove")
    if not actions:
        raise ValueError(f"父本 {parent.parent_id} 在当前池子与权重范围内无法局部变异")

    action = rng.choice(actions)
    changes: list[WeightChange] = []
    if action == "weight":
        mutable = [
            index
            for index, item in enumerate(weights)
            if item.weight - WEIGHT_STEP >= config.lower - _EPSILON
            or item.weight + WEIGHT_STEP <= config.upper + _EPSILON
        ]
        index = rng.choice(mutable)
        before = weights[index]
        deltas = [
            delta
            for delta in (-0.2, -0.1, 0.1, 0.2)
            if config.lower - _EPSILON <= before.weight + delta <= config.upper + _EPSILON
        ]
        after_weight = discretize_weight(
            before.weight + rng.choice(deltas), config.lower, config.upper
        )
        weights[index] = ArtistWeight(before.artist_id, after_weight)
        changes.append(WeightChange(before.artist_id, before.weight, after_weight))
    elif action == "replace":
        index = rng.randrange(len(weights))
        before = weights[index]
        artist_id = rng.choice([item for item in pool if item not in used])
        weights[index] = ArtistWeight(artist_id, before.weight)
        changes.extend(
            (
                WeightChange(before.artist_id, before.weight, None),
                WeightChange(artist_id, None, before.weight),
            )
        )
    elif action == "add":
        artist_id = rng.choice([item for item in pool if item not in used])
        weight = sample_weight(config, rng)
        weights.append(ArtistWeight(artist_id, weight))
        changes.append(WeightChange(artist_id, None, weight))
    else:
        index = rng.randrange(len(weights))
        before = weights.pop(index)
        changes.append(WeightChange(before.artist_id, before.weight, None))

    result = tuple(weights)
    return DeepCandidate(
        result,
        build_artist_string(result),
        (parent.parent_id,),
        "local_mutation",
        tuple(changes),
    )


def _random_injection(
    pool: Sequence[str], config: WeightSamplingConfig, rng: random.Random
) -> DeepCandidate:
    basic = generate_basic_candidate(pool, min(2, len(pool)), config, rng)
    return DeepCandidate(
        basic.artist_weights,
        basic.artist_string,
        (),
        "random_injection",
        tuple(WeightChange(item.artist_id, None, item.weight) for item in basic.artist_weights),
    )


def _crossover(
    parents: Sequence[DeepParent], config: WeightSamplingConfig, rng: random.Random
) -> DeepCandidate:
    first = _weighted_parent(parents, rng)
    second = _weighted_parent([parent for parent in parents if parent.parent_id != first.parent_id], rng)
    first_map = {item.artist_id: item.weight for item in first.artist_weights}
    second_map = {item.artist_id: item.weight for item in second.artist_weights}
    shared = set(first_map) & set(second_map)
    child: list[ArtistWeight] = []

    # 至少从两个父本取得贡献；同 ID 时用两者均值表示交叉。
    first_seed = rng.choice(first.artist_weights)
    child.append(first_seed)
    second_choices = [item for item in second.artist_weights if item.artist_id != first_seed.artist_id]
    if second_choices:
        child.append(rng.choice(second_choices))
    elif first_seed.artist_id in second_map:
        child[0] = ArtistWeight(
            first_seed.artist_id,
            discretize_weight(
                (first_seed.weight + second_map[first_seed.artist_id]) / 2,
                config.lower,
                config.upper,
            ),
        )

    used = {item.artist_id for item in child}
    union = list(first.artist_weights) + [
        item for item in second.artist_weights if item.artist_id not in first_map
    ]
    rng.shuffle(union)
    for item in union:
        if item.artist_id in used or len(child) >= 10 or rng.random() >= 0.55:
            continue
        if item.artist_id in shared and rng.random() < 0.5:
            weight = discretize_weight(
                (first_map[item.artist_id] + second_map[item.artist_id]) / 2,
                config.lower,
                config.upper,
            )
            child.append(ArtistWeight(item.artist_id, weight))
        else:
            child.append(item)
        used.add(item.artist_id)

    result = tuple(child)
    changes = _weight_changes(first.artist_weights, result)
    return DeepCandidate(
        result,
        build_artist_string(result),
        (first.parent_id, second.parent_id),
        "crossover",
        changes,
    )


def _weighted_parent(parents: Sequence[DeepParent], rng: random.Random) -> DeepParent:
    # 固定基线保证最低偏好父本仍有非零机会，不会被绝对垄断。
    weights = [0.25 + parent.preference for parent in parents]
    return rng.choices(list(parents), weights=weights, k=1)[0]


def _weight_changes(
    before: Sequence[ArtistWeight], after: Sequence[ArtistWeight]
) -> tuple[WeightChange, ...]:
    before_map = {item.artist_id: item.weight for item in before}
    after_map = {item.artist_id: item.weight for item in after}
    ids = list(before_map) + [artist_id for artist_id in after_map if artist_id not in before_map]
    return tuple(
        WeightChange(artist_id, before_map.get(artist_id), after_map.get(artist_id))
        for artist_id in ids
        if before_map.get(artist_id) != after_map.get(artist_id)
    )


def _candidate_key(weights: Sequence[ArtistWeight]) -> tuple[tuple[str, float], ...]:
    return tuple(sorted((item.artist_id, item.weight) for item in weights))


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
